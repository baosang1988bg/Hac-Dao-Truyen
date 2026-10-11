"""Ngân sách ghi Cloudflare cho các script sync.

Hai lớp chặn:
- Cầu chì cục bộ (HACDAO_*; bộ đếm tools/.cloud_sync_budget.json), mặc định 0.
- Số liệu THẬT của tài khoản (tools/cloudflare_usage.py, GraphQL Analytics): chụp
  lúc bắt đầu run, cộng phần run này đã ghi, dừng trước khi vượt real_ratio
  (mặc định 80%) hạn mức gói Free cho D1 dòng ghi/ngày và R2 Class A/tháng.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
import time


def atomic_json(path, data):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',dir=path.parent,encoding='utf-8',delete=False) as f:
        temp=Path(f.name)
        try:
            json.dump(data,f,ensure_ascii=False,indent=2)
            f.flush();os.fsync(f.fileno())
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    try:os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)


class SyncBudget:
    def __init__(self,state_path,r2_monthly_budget=0,d1_daily_budget=0,max_ops_per_run=0,
                 real_usage=None,real_ratio=0.8):
        if any(type(n) is not int or n<0 for n in (r2_monthly_budget,d1_daily_budget,max_ops_per_run)):
            raise ValueError('Ngân sách phải là số nguyên không âm')
        self.state_path=Path(state_path)
        self.r2_monthly_budget=r2_monthly_budget
        self.d1_daily_budget=d1_daily_budget
        self.max_ops_per_run=max_ops_per_run
        self._run_ops=0
        # Số liệu thật chụp đầu run (None = không lấy được → chỉ dùng cầu chì).
        self.real_usage=real_usage
        self.real_ratio=real_ratio
        self._run_r2=0
        self._run_d1=0
        self._lock=threading.Lock()
        self.stopped_reason=None

    @contextmanager
    def _locked(self):
        # mkdir nguyên tử ngăn nhiều process cùng máy dùng mất cập nhật. Không
        # tự bỏ lock cũ sau crash: dừng để kiểm tra, tránh reset ngân sách ngầm.
        with self._lock:
            lock=self.state_path.with_name(self.state_path.name+'.lock')
            lock.parent.mkdir(parents=True,exist_ok=True)
            deadline=time.monotonic()+5
            while True:
                try:lock.mkdir();break
                except FileExistsError:
                    if time.monotonic()>deadline:raise RuntimeError(f'Budget đang bị khóa: {lock}')
                    time.sleep(.01)
            try:yield
            finally:lock.rmdir()

    def _load(self):
        state=json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        if not isinstance(state,dict):raise ValueError('Budget state không hợp lệ')
        for key in ('r2_ops','d1_ops'):
            if type(state.get(key,0)) is not int or state.get(key,0)<0:raise ValueError('Budget counter không hợp lệ')
        now=datetime.now(timezone.utc)
        for period,fmt,counter in [('r2_month','%Y-%m','r2_ops'),('d1_day','%Y-%m-%d','d1_ops')]:
            if state.get(period)!=now.strftime(fmt):state.update({period:now.strftime(fmt),counter:0})
        return state

    def try_reserve(self,r2_ops,d1_ops):
        if any(type(n) is not int or n<0 for n in (r2_ops,d1_ops)):raise ValueError('Số thao tác không hợp lệ')
        real_block=self._real_usage_blocker(r2_ops,d1_ops)
        if real_block:
            self.stopped_reason=real_block
            return False
        with self._locked():
            state=self._load()
            if (state.get('r2_ops',0)+r2_ops>self.r2_monthly_budget
                    or state.get('d1_ops',0)+d1_ops>self.d1_daily_budget
                    or self._run_ops+r2_ops+d1_ops>self.max_ops_per_run):
                self.stopped_reason='Hết ngân sách được cấu hình; chưa gửi request'
                return False
            state['r2_ops']=state.get('r2_ops',0)+r2_ops
            state['d1_ops']=state.get('d1_ops',0)+d1_ops
            # Lưu thất bại phải ném lỗi TRƯỚC request; không hoàn lại sau timeout.
            atomic_json(self.state_path,state)
            self._run_ops+=r2_ops+d1_ops
            self._run_r2+=r2_ops
            self._run_d1+=d1_ops
            return True
    def _real_usage_blocker(self,r2_ops,d1_ops):
        """Lý do dừng theo số liệu thật (None = an toàn). Không chặn theo dung
        lượng R2 — vượt chỉ tốn phí lưu trữ, chặn sẽ ngưng mọi cập nhật chương."""
        if not self.real_usage:return None
        from tools.cloudflare_usage import FREE_LIMITS
        for key,run_used,want,label in (('d1_rows_written_day',self._run_d1,d1_ops,'D1 dòng ghi hôm nay'),
                                        ('r2_class_a_month',self._run_r2,r2_ops,'R2 Class A tháng này')):
            cap=int(FREE_LIMITS[key]*self.real_ratio)
            total=self.real_usage.get(key,0)+run_used+want
            if total>cap:
                return (f'Sắp chạm hạn mức Cloudflare thật: {label} {total:,} > {cap:,} '
                        f'({self.real_ratio:.0%} gói Free); chưa gửi request')
        return None

    def summary(self):
        with self._locked():
            state=self._load()
            return f"Ước tính R2 {state.get('r2_ops',0)}/{self.r2_monthly_budget}; D1 {state.get('d1_ops',0)}/{self.d1_daily_budget}; tổng lần chạy {self._run_ops}/{self.max_ops_per_run}"


def real_usage_from_env():
    """Chụp số liệu thật Cloudflare (tắt bằng HACDAO_REAL_USAGE_GUARD=0)."""
    if os.getenv('HACDAO_REAL_USAGE_GUARD','1').strip()=='0':
        return None
    from tools.cloudflare_usage import current_usage
    usage,err=current_usage()
    if usage is None:
        print(f'⚠️ Không lấy được số liệu thật Cloudflare ({err}) — chỉ dùng cầu chì HACDAO_*')
    else:
        print(f"📊 Cloudflare thật: D1 ghi hôm nay {usage['d1_rows_written_day']:,}; "
              f"R2 Class A tháng {usage['r2_class_a_month']:,}")
    return usage


def budget_from_env():
    return SyncBudget(os.getenv('HACDAO_BUDGET_FILE',str(Path(__file__).parent/'.cloud_sync_budget.json')),
                      int(os.getenv('HACDAO_R2_WRITE_BUDGET','0')),
                      int(os.getenv('HACDAO_D1_WRITE_BUDGET','0')),
                      int(os.getenv('HACDAO_MAX_OPS_PER_RUN','0')),
                      real_usage=real_usage_from_env(),
                      real_ratio=float(os.getenv('HACDAO_REAL_USAGE_RATIO','0.8')))


def require_cloud_writes():
    if os.getenv('HACDAO_ALLOW_CLOUD_WRITES','').lower()!='true':
        raise RuntimeError('Ghi cloud đang tắt. Kiểm tra billing/ngân sách trước khi đặt HACDAO_ALLOW_CLOUD_WRITES=true.')

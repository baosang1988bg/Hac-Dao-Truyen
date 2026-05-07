// commitlint.config.js
// Kiểm tra format commit message theo Conventional Commits
// Xem thêm: https://www.conventionalcommits.org
//
// Format: <type>(<scope>): <subject>
// Ví dụ:
//   feat(translator): thêm hỗ trợ Groq provider
//   fix(scraper): sửa lỗi encoding GBK trên 69shuba
//   docs: cập nhật README với hướng dẫn Ollama
//   chore: cập nhật dependencies
//   refactor(api): tách logic translate ra service riêng

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Cho phép scope tuỳ ý (translator, scraper, api, frontend, etc.)
    'scope-enum': [0],
    // Subject không bắt buộc chữ thường (hỗ trợ tiếng Việt)
    'subject-case': [0],
    // Giới hạn độ dài header
    'header-max-length': [2, 'always', 100],
    // Các type hợp lệ
    'type-enum': [
      2,
      'always',
      [
        'feat',     // Tính năng mới
        'fix',      // Sửa bug
        'docs',     // Tài liệu
        'style',    // Format, không thay đổi logic
        'refactor', // Refactor code
        'perf',     // Cải thiện hiệu năng
        'test',     // Thêm / sửa tests
        'chore',    // Build, dependencies, config
        'ci',       // CI/CD
        'revert',   // Revert commit trước
      ],
    ],
  },
};

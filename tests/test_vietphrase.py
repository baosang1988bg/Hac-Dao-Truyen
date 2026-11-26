import pytest
from tools.converter.vietphrase import VietphraseTrie, VietphraseConverter, PUNCTUATION_MAP


def test_trie_insert_and_match():
    trie = VietphraseTrie()
    trie.insert("神宠", "Thần sủng")
    trie.insert("神宠供应商", "Thần Sủng Thương Nghiệp Cung Ứng Thương")

    # Longest match check on Trie root
    node = trie.root
    word = "神宠供应商"
    matched_val = None
    for char in word:
        assert char in node.children
        node = node.children[char]
        if node.is_end:
            matched_val = node.value

    assert matched_val == "Thần Sủng Thương Nghiệp Cung Ứng Thương"


def test_converter_punctuation():
    converter = VietphraseConverter()
    text = "“轰！无边沧海，撞向礁石。”"
    converted = converter.convert_paragraph(text)
    assert "!" in converted
    assert "," in converted
    assert '"' in converted
    assert "，" not in converted
    assert "。" not in converted


def test_converter_glossary_priority():
    glossary = {
        "洛羽": "Lạc Vũ Siêu Cấp",
        "墨水鱼": "Mực Nước Thần Thoại",
    }
    converter = VietphraseConverter(glossary)
    text = "洛羽看着池塘里的墨水鱼。"
    converted = converter.convert_paragraph(text)
    assert "Lạc Vũ Siêu Cấp" in converted
    assert "Mực Nước Thần Thoại" in converted


def test_converter_chapter_formatting():
    converter = VietphraseConverter({"测试": "Thử nghiệm"})
    raw = "第一段测试。\n\n第二段内容！"
    output = converter.convert_chapter(raw, "Chương 1: Tiêu đề")
    assert output.startswith("# Chương 1: Tiêu đề\n\n")
    assert "Thử nghiệm." in output

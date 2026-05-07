import unittest
import os
import shutil
from novel_manager import (
    NovelProfile,
    slugify,
    create_novel,
    load_novel,
    list_novel_slugs,
    list_novels,
    NOVELS_BASE_DIR
)

class TestNovelManager(unittest.TestCase):
    def setUp(self):
        # Create a temporary test directory
        self.test_dir = "test_novels"
        self.original_base_dir = NOVELS_BASE_DIR
        
        # Override the NOVELS_BASE_DIR temporarily for testing
        import novel_manager
        novel_manager.NOVELS_BASE_DIR = self.test_dir
        
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)
        os.makedirs(self.test_dir)

    def tearDown(self):
        # Restore original base dir
        import novel_manager
        novel_manager.NOVELS_BASE_DIR = self.original_base_dir
        
        # Clean up
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)

    def test_slugify(self):
        self.assertEqual(slugify("Thần Đạo Đế Tôn"), "thần-đạo-đế-tôn")
        self.assertEqual(slugify("Hello World! 123"), "hello-world-123")
        self.assertEqual(slugify("   Test_-_-Slug   "), "test-slug")

    def test_create_novel(self):
        profile = create_novel(
            title="Test Novel",
            source_url="http://example.com/1",
            slug="test-novel"
        )
        self.assertEqual(profile.title, "Test Novel")
        self.assertEqual(profile.slug, "test-novel")
        self.assertTrue(os.path.exists(profile.profile_path))
        self.assertTrue(os.path.exists(profile.raw_dir))
        self.assertTrue(os.path.exists(profile.translated_dir))

    def test_create_novel_duplicate(self):
        create_novel(title="Test", source_url="url", slug="test")
        with self.assertRaises(ValueError):
            create_novel(title="Test", source_url="url", slug="test")

    def test_load_novel(self):
        create_novel(title="To Load", source_url="url", slug="to-load")
        profile = load_novel("to-load")
        self.assertEqual(profile.title, "To Load")
        self.assertEqual(profile.slug, "to-load")

    def test_load_novel_not_found(self):
        with self.assertRaises(FileNotFoundError):
            load_novel("non-existent")

    def test_update_progress(self):
        profile = create_novel(title="Progress", source_url="url", slug="progress")
        profile.update_progress("http://example.com/2", 1)
        
        loaded = load_novel("progress")
        self.assertEqual(loaded.last_translated_url, "http://example.com/2")
        self.assertEqual(loaded.last_chapter_number, 1)

    def test_add_glossary_entry(self):
        profile = create_novel(title="Glossary", source_url="url", slug="glossary")
        profile.add_glossary_entry("Hello", "Xin chao")
        
        loaded = load_novel("glossary")
        self.assertIn("Hello", loaded.glossary)
        self.assertEqual(loaded.glossary["Hello"], "Xin chao")

    def test_list_novel_slugs_and_novels(self):
        self.assertEqual(list_novel_slugs(), [])
        
        create_novel(title="Novel A", source_url="a", slug="a")
        create_novel(title="Novel B", source_url="b", slug="b")
        
        slugs = list_novel_slugs()
        self.assertEqual(len(slugs), 2)
        self.assertIn("a", slugs)
        self.assertIn("b", slugs)
        
        novels = list_novels()
        self.assertEqual(len(novels), 2)
        titles = [n.title for n in novels]
        self.assertIn("Novel A", titles)
        self.assertIn("Novel B", titles)

if __name__ == '__main__':
    unittest.main()

import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "mods", "shortcut-board", "fetch_board.py")

spec = importlib.util.spec_from_file_location("fetch_board", SCRIPT)
fetch_board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_board)


class DemoStoryTest(unittest.TestCase):
    def test_story_carries_the_suggested_branch_name(self):
        story = fetch_board.demo_story(1188)
        self.assertEqual(story["branch"], "sc-1188-retry-webhook-deliveries-with-backoff")


if __name__ == "__main__":
    unittest.main()

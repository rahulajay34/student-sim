import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fetch import ffmpeg_cmd


class TestFetch(unittest.TestCase):
    def test_ffmpeg_cmd(self):
        cmd = ffmpeg_cmd("https://x/m.m3u8", Path("/tmp/a.wav"))
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-f", cmd); self.assertEqual(cmd[cmd.index("-f") + 1], "wav")
        self.assertIn("-ac", cmd); self.assertEqual(cmd[cmd.index("-ac") + 1], "1")
        self.assertIn("-ar", cmd); self.assertEqual(cmd[cmd.index("-ar") + 1], "16000")
        self.assertEqual(cmd[-1], "/tmp/a.wav")

if __name__ == "__main__":
    unittest.main()

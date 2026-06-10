import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyze import wpm, pause_ratio, semitone_std, group_spans

W = lambda s, e: {"start": s, "end": e, "word": "w"}


class TestMetrics(unittest.TestCase):
    def test_wpm(self):
        self.assertAlmostEqual(wpm(words=150, speech_seconds=60.0), 150.0)
        self.assertEqual(wpm(words=10, speech_seconds=0.0), 0.0)

    def test_group_spans_splits_on_gap(self):
        words = [W(0, 1), W(1.2, 2), W(4.0, 5)]  # 2s gap before third word
        spans = group_spans(words, gap=1.0)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["start"], 0)
        self.assertEqual(spans[1]["start"], 4.0)
        self.assertEqual(spans[0]["words"], 2)

    def test_pause_ratio(self):
        spans = [{"start": 0, "end": 4, "words": 8}, {"start": 6, "end": 8, "words": 4}]
        # speech 6s of 0..8 window -> pauses 2s -> ratio 0.25
        self.assertAlmostEqual(pause_ratio(spans, total_seconds=8.0), 0.25)

    def test_semitone_std(self):
        self.assertAlmostEqual(semitone_std([100.0, 100.0, 100.0]), 0.0)
        self.assertGreater(semitone_std([100.0, 200.0, 100.0, 200.0]), 5.0)

if __name__ == "__main__":
    unittest.main()

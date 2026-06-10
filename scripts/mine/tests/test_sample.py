import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sample import pick_sample


def mk(i, counselor, paid, dur=15.0, chars=8000, url="https://x/y.m3u8"):
    return {"id": f"id{i:03d}", "counselor": counselor, "paid": paid,
            "durationMin": dur, "transcriptChars": chars, "recordingUrl": url}


class TestSample(unittest.TestCase):
    def test_strata_and_diversity(self):
        calls = ([mk(i, f"c{i % 3}", True) for i in range(15)] +
                 [mk(100 + i, f"c{i % 3}", False) for i in range(40)])
        s = pick_sample(calls)
        self.assertEqual(len(s), 20)
        self.assertEqual(sum(1 for c in s if c["paid"]), 10)
        self.assertGreaterEqual(len({c["counselor"] for c in s if c["paid"]}), 3)

    def test_eligibility_filters(self):
        calls = [mk(1, "a", True, dur=3.0),            # too short
                 mk(2, "a", True, chars=100),           # transcript too thin
                 mk(3, "a", True, url=""),              # no recording
                 mk(4, "a", True)]                      # eligible
        s = pick_sample(calls)
        self.assertEqual([c["id"] for c in s if c["paid"]], ["id004"])

    def test_small_pool_doesnt_loop_forever(self):
        s = pick_sample([mk(1, "a", True), mk(2, "b", False)])
        self.assertEqual(len(s), 2)

    def test_pool_smaller_than_group_uneven_queues(self):
        # paid pool (3) < per_group (10), queues drain unevenly (a:2, b:1), unpaid empty
        calls = [mk(1, "a", True, dur=20.0), mk(2, "a", True, dur=18.0),
                 mk(3, "b", True, dur=16.0)]
        s = pick_sample(calls)
        self.assertEqual([c["id"] for c in s], ["id001", "id003", "id002"])  # round-robin a,b,a

if __name__ == "__main__":
    unittest.main()

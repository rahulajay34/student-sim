import json, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare import load_calls, compute_stats

FIXTURE = Path(__file__).parent / "fixture.csv"

class TestPrepare(unittest.TestCase):
    def setUp(self):
        self.calls = load_calls(FIXTURE)

    def test_loads_all_rows(self):
        self.assertEqual(len(self.calls), 3)

    def test_paid_flag(self):
        self.assertEqual([c["paid"] for c in self.calls], [True, False, False])

    def test_multiline_transcript_preserved(self):
        self.assertIn("Line two, with comma.", self.calls[0]["transcript"])

    def test_ids_stable_unique_no_email(self):
        ids = [c["id"] for c in self.calls]
        self.assertEqual(len(set(ids)), 3)
        for c in self.calls:
            self.assertRegex(c["id"], r"^[0-9a-f]{10}$")
            self.assertNotIn("Email", c)
            safe_fields = {k: v for k, v in c.items() if k != "transcript"}
            self.assertNotIn("@", json.dumps(safe_fields))
        self.assertEqual(load_calls(FIXTURE)[0]["id"], ids[0])  # stable across runs

    def test_stats(self):
        s = compute_stats(self.calls)
        self.assertEqual(s["totalCalls"], 3)
        self.assertEqual(s["paidCalls"], 1)
        self.assertEqual(s["perCounselor"]["alpha"]["calls"], 2)
        self.assertAlmostEqual(s["durationMin"]["max"], 30.0)

if __name__ == "__main__":
    unittest.main()

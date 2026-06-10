import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_batches import make_batches


class TestBatches(unittest.TestCase):
    def test_chunking(self):
        calls = [{"id": f"i{n}", "counselor": "a", "durationMin": 10.0,
                  "paid": False, "transcript": "t", "transcriptChars": 1,
                  "slotDate": "x", "recordingUrl": "u"} for n in range(17)]
        batches = make_batches(calls, size=8)
        self.assertEqual([len(b["calls"]) for b in batches], [8, 8, 1])
        self.assertEqual(batches[0]["batchId"], "batch-01")
        self.assertEqual(batches[2]["batchId"], "batch-03")
        ids = [c["id"] for b in batches for c in b["calls"]]
        self.assertEqual(ids, [f"i{n}" for n in range(17)])
        self.assertNotIn("recordingUrl", batches[0]["calls"][0])  # slim payload

if __name__ == "__main__":
    unittest.main()

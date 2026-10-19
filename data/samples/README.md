# Sample data

`cicids2017-friday-ddos-sample.csv` comes from the original project (`backend/data/sample.csv`).
It holds the first 500 `BENIGN` and the first 500 `DDoS` rows of the CICIDS2017
`Friday-WorkingHours-Afternoon-DDos` MachineLearningCVE file, with trimmed headers.

What it is good for: exercising the import → scoring → explanation → evaluation pipeline
end to end, and training the small benchmark model (`npm run ml:train:sample`).

What it is not: a representative dataset. It has two classes, one attacker IP and a
26-minute window. A model trained on it scores near-perfectly on a random split and
much worse on unseen source IPs; the model card reports both.

Timestamps follow CICIDS2017's day/month/year format; afternoon files use a 12-hour clock
without AM/PM (03:56 means 15:56). Sentinel stores them "as recorded" and does not guess.

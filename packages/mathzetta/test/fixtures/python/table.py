"""A template over a small table, for the mathzetta-python tests: prints a
formula's value for the rows a second formula keeps."""
import csv
import numpy as np

# mathzetta-data: rows.csv
# mathzetta-options: numpy

# Which rows.
# mathzetta: keep(data: columns) = year >= 2000
# The value printed for each.
# mathzetta: value(data: columns) = HR / AB

with open(DATA_FILE, newline="", encoding="utf-8") as f:
    header, *rows = list(csv.reader(f))
table = {name: np.array([row[i] for row in rows]) for i, name in enumerate(header)}
for name in header[1:]:
    table[name] = table[name].astype(float)
print(" ".join(f"{v:.3f}" for v in np.asarray(value(table))[keep(table)]))

# Python templates

A template is an ordinary Python program with **slots**: comment lines where
a formula goes. `fillPythonTemplate` (or the `mathzetta-python` command)
turns each slot into a Python function and the program runs.

```python
# mathzetta-data: ../data/batting.csv        the table the program reads; becomes DATA_FILE = "…"
# mathzetta-options: numpy                   element-wise over arrays (and errors=nan to give nan for 1/0)
# How fast it grows.                         ← the comment above a slot is its description (preparePythonTemplate's doc)
# mathzetta: growth(P, r, K) = r P (1 - P/K)
# mathzetta: keep(data: columns) = year >= 1990
```

A slot gives the function's name and parameters — how the program calls it —
and a default formula. A parameter written `data: columns` holds the table:
the formula can use any column by name (`H / AB`, `2B`), and with numpy
`sum(HR)`, `max(HR)`, `mean(HR)`, `median(HR)`, `stdev(HR)` are over the
column. Each filled function also gets `.formula` (the text) and `.latex`
(for matplotlib labels). Formulas can only do maths: calls like `print` or
`exec`, attributes and unknown names are refused.

```bash
node tools/python-template.js examples/python/logistic.py --slots                  # the slots
node tools/python-template.js examples/python/logistic.py growth='r P ln(K / P) - h' --run
node tools/python-template.js examples/python/logistic.py -o model.py              # fill to a file
```

`logistic.py` is a population model whose growth law is a slot.
**[pyslots](https://tabdn.com/pyslots/)** turns templates like it into web pages — a form
from the slots, the formulas drawn as maths, Python run in the browser
(Pyodide) or on a Flask server — and has the matplotlib chart examples over
baseball data (scatter, histogram, box plots, aging curve, trends, top-N,
pitcher density).

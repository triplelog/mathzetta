"""A population model whose growth law is a formula: fill it with mathzetta.

    import { fillPythonTemplate } from 'mathzetta/python';
    fillPythonTemplate(template, { growth: 'r P (1 - P/K) - h' });

Each `# mathzetta:` line is a slot: the signature is how this program calls
the function, the formula after `=` the default. Run as is, it fails (the
slots are comments); filled, it prints the population year by year.
"""

R = 0.4          # growth rate
K = 1000.0       # carrying capacity
HARVEST = 5.0    # taken each year

# mathzetta: growth(P, r, K, h) = r*P*(1 - P/K) - h


def simulate(p0, years, dt=0.1):
    p = p0
    history = [p]
    steps = round(1 / dt)
    for _ in range(years):
        for _ in range(steps):
            p = max(p + growth(p, R, K, HARVEST) * dt, 0.0)
        history.append(p)
    return history


if __name__ == "__main__":
    for year, p in enumerate(simulate(50.0, 10)):
        print(f"{year:3d}  {p:10.2f}")

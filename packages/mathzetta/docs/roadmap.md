# Uses
| Feature | v0.0 | v0.1 | v0.2 | v0.3 | v0.4 | v1 |
| ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| MathML | 0 | 0 | 0 | 0 | 0 | 0 |
| LaTeX | 0 | 0 | 0 | 0 | 0 | 0 |
| JavaScript Functions | 0 | 0 | 0 | 0 | 0 | 0 |
| Browser Data Tables | 0 | 0 | 0 | 0 | 0 | 0 |
| SQLite Server | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust Server | 0 | 0 | 0 | 0 | 0 | 0 |
| More Servers | 0 | 0 | 0 | 0 | 0 | 0 |
| Image Filters | 0 | 0 | 0 | 0 | 0 | 0 |
| Tree Visualizations | 0 | 0 | 0 | 0 | 0 | 0 |
| Simplification | 0 | 0 | 0 | 0 | 0 | 0 |
| Derivatives | 0 | 0 | 0 | 0 | 0 | 0 |

## MathML
Enter a math formula, display MathML. 
Embed in website. Lightweight
Want to support more functions like derivatives, etc... Ideally just about anything that might be used up to Calculus II.
Not as many supported features as KaTeX, but easier to use (especially for non-math people) and more lightweight.

## LaTeX
Enter a math formula, get LaTeX.
The LaTeX can be used for KaTeX or any other LaTeX renderer.
Perhaps a server that converts LaTeX to pdf?
Again, want to support more functions like derivatives, etc... Ideally just about anything that might be used up to Calculus II. Work well with KaTeX, but don't expect to handle everything.

## JavaScript Functions
User enters a formula and it gets converted to a JavaScript function. Should be safe to evaluate with whitelisted functions.
Could be used for games. Also, websites that want to allow users to enter custom formulas for any reason.
Also, evaluations to display. So 2+2={{2+2}} displays as 2+2=4.
weasyprint
jatijm:
texlive server with templates
markdown + math



## Browser Data Tables
Embed tables in a website that can be easily filtered with flexible input. The formulas are simply converted to JavaScript functions and applied to each row. These tables can easily be embedded anywhere. The tables do need to be small enough to send all the data to the client.

## SQLite Server
The formulas can be converted to SQL queries. Using redbean, it is possible to create servers that offer filtering functionality.

## Rust Server
How fast can these formulas be run over millions of rows?

## More Servers
Zig? Python, JavaScript. PHP?

## Image Filters
Fully customizable image filters (with respect to the input color value). Brushes that are also fully customizable.

## Tree Visualizations

## Simplifications

## Derivatives


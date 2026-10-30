import { type Macro, macroArity } from "@banki/shared";
import { NO_MACROS } from "@/lib/formula";
import { sampleOf } from "@/lib/macros";

// The LaTeX commands the editor knows (BAN-21): what its completion popup
// offers inside a Formula and what its cheatsheet lists, with the Deck's
// Macros (BAN-22) in a group of their own, first. Each is typeset by KaTeX 0.19.1,
// with mhchem's \ce and \pu (lib/formula.ts registers them).
//
// `snippet` is what is inserted, a `▯` for each slot the User fills in;
// `preview`, when given, is what its render shows instead (a sample to put
// an accent on). `common` ones come first among those that match.

export type CommandGroup =
  | "Macros"
  | "Greek"
  | "Operators"
  | "Relations"
  | "Arrows"
  | "Accents"
  | "Delimiters"
  | "Big operators"
  | "Fonts"
  | "Spacing"
  | "Environments"
  | "Chemistry";

export const GROUPS: readonly CommandGroup[] = [
  "Greek",
  "Operators",
  "Relations",
  "Arrows",
  "Accents",
  "Delimiters",
  "Big operators",
  "Fonts",
  "Spacing",
  "Environments",
  "Chemistry",
];

export type LatexCommand = {
  /** The command as typed, such as `\frac`. */
  name: string;
  snippet: string;
  group: CommandGroup;
  /** One line on what it is. */
  meaning: string;
  /** More words the cheatsheet's search finds it by. */
  keywords?: string;
  preview?: string;
  common?: boolean;
};

type Row = [name: string, meaning: string, extra?: Partial<LatexCommand>];

const rows = (group: CommandGroup, list: readonly Row[]): LatexCommand[] =>
  list.map(([name, meaning, extra]) => ({ name, snippet: name, group, meaning, ...extra }));

const greek: Row[] = [
  ["\\alpha", "Alpha", { common: true }],
  ["\\beta", "Beta", { common: true }],
  ["\\gamma", "Gamma", { common: true }],
  ["\\delta", "Delta", { common: true }],
  ["\\epsilon", "Epsilon"],
  ["\\varepsilon", "Epsilon, curly form", { common: true }],
  ["\\zeta", "Zeta"],
  ["\\eta", "Eta"],
  ["\\theta", "Theta", { common: true, keywords: "angle" }],
  ["\\vartheta", "Theta, curly form"],
  ["\\iota", "Iota"],
  ["\\kappa", "Kappa"],
  ["\\lambda", "Lambda", { common: true, keywords: "wavelength eigenvalue" }],
  ["\\mu", "Mu", { common: true, keywords: "mean micro" }],
  ["\\nu", "Nu", { keywords: "frequency" }],
  ["\\xi", "Xi"],
  ["\\pi", "Pi", { common: true, keywords: "circle" }],
  ["\\varpi", "Pi, curly form"],
  ["\\rho", "Rho", { common: true, keywords: "density" }],
  ["\\varrho", "Rho, curly form"],
  ["\\sigma", "Sigma", { common: true, keywords: "standard deviation" }],
  ["\\varsigma", "Final sigma"],
  ["\\tau", "Tau", { keywords: "torque" }],
  ["\\upsilon", "Upsilon"],
  ["\\phi", "Phi", { common: true }],
  ["\\varphi", "Phi, curly form", { common: true }],
  ["\\chi", "Chi"],
  ["\\psi", "Psi", { keywords: "wave function" }],
  ["\\omega", "Omega", { common: true, keywords: "angular frequency" }],
  ["\\Gamma", "Capital gamma", { keywords: "gamma function" }],
  ["\\Delta", "Capital delta", { common: true, keywords: "change difference" }],
  ["\\Theta", "Capital theta"],
  ["\\Lambda", "Capital lambda"],
  ["\\Xi", "Capital xi"],
  ["\\Pi", "Capital pi"],
  ["\\Sigma", "Capital sigma"],
  ["\\Upsilon", "Capital upsilon"],
  ["\\Phi", "Capital phi", { keywords: "flux" }],
  ["\\Psi", "Capital psi"],
  ["\\Omega", "Capital omega", { keywords: "ohm resistance" }],
];

const operators: Row[] = [
  ["\\frac", "Fraction", { snippet: "\\frac{▯}{▯}", common: true, keywords: "divide over ratio" }],
  ["\\dfrac", "Fraction, full size", { snippet: "\\dfrac{▯}{▯}", keywords: "divide display" }],
  ["\\tfrac", "Fraction, small", { snippet: "\\tfrac{▯}{▯}", keywords: "divide text" }],
  ["\\sqrt", "Square root", { snippet: "\\sqrt{▯}", common: true, keywords: "root radical" }],
  ["\\sqrt[n]", "n-th root", { snippet: "\\sqrt[▯]{▯}", keywords: "root radical cube" }],
  ["\\binom", "Binomial coefficient", { snippet: "\\binom{▯}{▯}", keywords: "choose combination" }],
  ["\\cdot", "Centred dot", { common: true, keywords: "times multiply product dot" }],
  ["\\times", "Times sign", { common: true, keywords: "multiply cross product" }],
  ["\\div", "Division sign", { keywords: "divide obelus" }],
  ["\\pm", "Plus or minus", { common: true, keywords: "plus minus" }],
  ["\\mp", "Minus or plus"],
  ["\\ast", "Asterisk", { keywords: "star convolution" }],
  ["\\star", "Star"],
  ["\\circ", "Ring operator", { keywords: "compose composition degree" }],
  ["\\bullet", "Bullet"],
  ["\\oplus", "Circled plus", { keywords: "direct sum xor" }],
  ["\\otimes", "Circled times", { keywords: "tensor product" }],
  ["\\cup", "Union", { keywords: "set or" }],
  ["\\cap", "Intersection", { keywords: "set and" }],
  ["\\setminus", "Set difference", { keywords: "minus without" }],
  ["\\wedge", "Logical and", { keywords: "wedge product conjunction" }],
  ["\\vee", "Logical or", { keywords: "disjunction" }],
  ["\\neg", "Logical not", { keywords: "negation" }],
  ["\\nabla", "Nabla", { keywords: "gradient del" }],
  ["\\partial", "Partial derivative", { common: true, keywords: "derivative" }],
  ["\\infty", "Infinity", { common: true, keywords: "infinite" }],
  ["\\emptyset", "Empty set"],
  ["\\forall", "For all", { keywords: "every quantifier" }],
  ["\\exists", "There exists", { keywords: "quantifier some" }],
  ["\\ldots", "Dots on the line", { keywords: "ellipsis" }],
  ["\\cdots", "Centred dots", { keywords: "ellipsis" }],
  ["\\vdots", "Vertical dots", { keywords: "ellipsis" }],
  ["\\ddots", "Diagonal dots", { keywords: "ellipsis" }],
  ["\\prime", "Prime", { keywords: "derivative dash" }],
  ["\\degree", "Degree sign", { keywords: "angle temperature" }],
  ["\\angle", "Angle"],
  ["\\triangle", "Triangle"],
  ["\\flat", "Flat", { keywords: "music" }],
  ["\\hbar", "Reduced Planck constant", { keywords: "planck h bar" }],
  ["\\ell", "Script small l", { keywords: "length" }],
  ["\\Re", "Real part"],
  ["\\Im", "Imaginary part"],
  ["\\sin", "Sine", { common: true, keywords: "trig" }],
  ["\\cos", "Cosine", { common: true, keywords: "trig" }],
  ["\\tan", "Tangent", { keywords: "trig" }],
  ["\\cot", "Cotangent", { keywords: "trig" }],
  ["\\sec", "Secant", { keywords: "trig" }],
  ["\\csc", "Cosecant", { keywords: "trig" }],
  ["\\arcsin", "Inverse sine", { keywords: "trig arc" }],
  ["\\arccos", "Inverse cosine", { keywords: "trig arc" }],
  ["\\arctan", "Inverse tangent", { keywords: "trig arc" }],
  ["\\sinh", "Hyperbolic sine"],
  ["\\cosh", "Hyperbolic cosine"],
  ["\\tanh", "Hyperbolic tangent"],
  ["\\log", "Logarithm", { common: true }],
  ["\\ln", "Natural logarithm", { common: true, keywords: "log e" }],
  ["\\exp", "Exponential", { keywords: "e power" }],
  ["\\lim", "Limit", { snippet: "\\lim_{▯}", common: true, keywords: "tends approaches" }],
  ["\\max", "Maximum"],
  ["\\min", "Minimum"],
  ["\\sup", "Supremum", { keywords: "least upper bound" }],
  ["\\inf", "Infimum", { keywords: "greatest lower bound" }],
  ["\\det", "Determinant", { keywords: "matrix" }],
  ["\\gcd", "Greatest common divisor"],
  ["\\deg", "Degree of a polynomial"],
  ["\\dim", "Dimension"],
  ["\\ker", "Kernel"],
  ["\\mod", "Modulo", { snippet: "\\mod{▯}", keywords: "remainder congruence" }],
  [
    "\\operatorname",
    "A named operator",
    { snippet: "\\operatorname{▯}", preview: "\\operatorname{rank}", keywords: "function name" },
  ],
];

const relations: Row[] = [
  ["\\leq", "Less than or equal to", { common: true, keywords: "le smaller" }],
  ["\\geq", "Greater than or equal to", { common: true, keywords: "ge bigger" }],
  ["\\neq", "Not equal to", { common: true, keywords: "ne different" }],
  ["\\approx", "Approximately equal to", { common: true, keywords: "about roughly" }],
  ["\\equiv", "Identical to", { keywords: "congruent equivalent" }],
  ["\\sim", "Similar to", { keywords: "tilde distributed" }],
  ["\\simeq", "Asymptotically equal to"],
  ["\\cong", "Congruent to", { keywords: "isomorphic" }],
  ["\\propto", "Proportional to"],
  ["\\ll", "Much less than"],
  ["\\gg", "Much greater than"],
  ["\\in", "Element of", { common: true, keywords: "member belongs set" }],
  ["\\notin", "Not an element of", { keywords: "member set" }],
  ["\\ni", "Contains as member"],
  ["\\subset", "Subset of", { keywords: "set" }],
  ["\\subseteq", "Subset of or equal to", { keywords: "set" }],
  ["\\supset", "Superset of", { keywords: "set" }],
  ["\\supseteq", "Superset of or equal to", { keywords: "set" }],
  ["\\perp", "Perpendicular to", { keywords: "orthogonal" }],
  ["\\parallel", "Parallel to"],
  ["\\mid", "Divides", { keywords: "given conditional bar" }],
  ["\\models", "Models", { keywords: "entails" }],
  ["\\vdash", "Proves", { keywords: "turnstile" }],
  ["\\frown", "Frown", { keywords: "arc" }],
  ["\\coloneqq", "Defined as", { keywords: "definition assign" }],
  [
    "\\stackrel",
    "One symbol over a relation",
    { snippet: "\\stackrel{▯}{▯}", preview: "\\stackrel{\\text{def}}{=}", keywords: "over above" },
  ],
];

const arrows: Row[] = [
  ["\\to", "Right arrow, tends to", { common: true, keywords: "maps approaches" }],
  ["\\rightarrow", "Right arrow"],
  ["\\leftarrow", "Left arrow", { keywords: "gets" }],
  ["\\leftrightarrow", "Left-right arrow"],
  ["\\Rightarrow", "Implies", { common: true, keywords: "double arrow therefore" }],
  ["\\Leftarrow", "Is implied by", { keywords: "double arrow" }],
  ["\\Leftrightarrow", "If and only if", { keywords: "iff double arrow equivalent" }],
  ["\\implies", "Implies, wide", { keywords: "therefore" }],
  ["\\iff", "If and only if, wide", { keywords: "equivalent" }],
  ["\\mapsto", "Maps to", { keywords: "function" }],
  ["\\uparrow", "Up arrow", { keywords: "increase" }],
  ["\\downarrow", "Down arrow", { keywords: "decrease" }],
  ["\\nearrow", "North-east arrow"],
  ["\\searrow", "South-east arrow"],
  ["\\hookrightarrow", "Hooked arrow", { keywords: "injection embedding" }],
  ["\\rightleftharpoons", "Equilibrium harpoons", { keywords: "reversible reaction" }],
  ["\\longrightarrow", "Long right arrow"],
  [
    "\\xrightarrow",
    "Arrow with a label",
    { snippet: "\\xrightarrow{▯}", preview: "\\xrightarrow{f}", keywords: "over label" },
  ],
];

const accents: Row[] = [
  [
    "\\hat",
    "Hat",
    { snippet: "\\hat{▯}", preview: "\\hat{a}", keywords: "circumflex unit vector estimator" },
  ],
  ["\\widehat", "Wide hat", { snippet: "\\widehat{▯}", preview: "\\widehat{AB}" }],
  [
    "\\bar",
    "Bar",
    { snippet: "\\bar{▯}", preview: "\\bar{x}", common: true, keywords: "mean average macron" },
  ],
  [
    "\\overline",
    "Line over",
    { snippet: "\\overline{▯}", preview: "\\overline{AB}", keywords: "conjugate segment" },
  ],
  ["\\underline", "Line under", { snippet: "\\underline{▯}", preview: "\\underline{x}" }],
  [
    "\\vec",
    "Vector arrow",
    { snippet: "\\vec{▯}", preview: "\\vec{v}", common: true, keywords: "vector" },
  ],
  [
    "\\overrightarrow",
    "Arrow over",
    { snippet: "\\overrightarrow{▯}", preview: "\\overrightarrow{AB}", keywords: "vector" },
  ],
  ["\\dot", "Dot", { snippet: "\\dot{▯}", preview: "\\dot{x}", keywords: "time derivative" }],
  [
    "\\ddot",
    "Double dot",
    { snippet: "\\ddot{▯}", preview: "\\ddot{x}", keywords: "second derivative" },
  ],
  ["\\tilde", "Tilde", { snippet: "\\tilde{▯}", preview: "\\tilde{n}" }],
  ["\\widetilde", "Wide tilde", { snippet: "\\widetilde{▯}", preview: "\\widetilde{AB}" }],
  ["\\acute", "Acute accent", { snippet: "\\acute{▯}", preview: "\\acute{e}" }],
  ["\\grave", "Grave accent", { snippet: "\\grave{▯}", preview: "\\grave{e}" }],
  ["\\breve", "Breve", { snippet: "\\breve{▯}", preview: "\\breve{u}" }],
  ["\\check", "Caron", { snippet: "\\check{▯}", preview: "\\check{c}" }],
  ["\\overbrace", "Brace over", { snippet: "\\overbrace{▯}^{▯}", preview: "\\overbrace{a+b}^{n}" }],
  [
    "\\underbrace",
    "Brace under",
    { snippet: "\\underbrace{▯}_{▯}", preview: "\\underbrace{a+b}_{n}" },
  ],
];

const delimiters: Row[] = [
  [
    "\\left(",
    "Parentheses that grow",
    { snippet: "\\left( ▯ \\right)", common: true, keywords: "brackets round paren" },
  ],
  ["\\left[", "Square brackets that grow", { snippet: "\\left[ ▯ \\right]", keywords: "brackets" }],
  [
    "\\left\\{",
    "Braces that grow",
    { snippet: "\\left\\{ ▯ \\right\\}", keywords: "curly brackets set" },
  ],
  ["\\left|", "Bars that grow", { snippet: "\\left| ▯ \\right|", keywords: "absolute value" }],
  ["\\langle", "Left angle bracket", { keywords: "inner product bra" }],
  ["\\rangle", "Right angle bracket", { keywords: "inner product ket" }],
  ["\\lfloor", "Left floor"],
  ["\\rfloor", "Right floor"],
  ["\\lceil", "Left ceiling"],
  ["\\rceil", "Right ceiling"],
  ["\\{", "Left brace", { keywords: "curly set" }],
  ["\\}", "Right brace", { keywords: "curly set" }],
  ["\\lvert", "Left bar", { keywords: "absolute value" }],
  ["\\rvert", "Right bar", { keywords: "absolute value" }],
  ["\\lVert", "Left double bar", { keywords: "norm" }],
  ["\\rVert", "Right double bar", { keywords: "norm" }],
  ["\\big(", "Bigger parenthesis", { keywords: "size" }],
  ["\\Big(", "Even bigger parenthesis", { keywords: "size" }],
];

const big: Row[] = [
  ["\\sum", "Sum", { snippet: "\\sum_{▯}^{▯}", common: true, keywords: "summation sigma series" }],
  ["\\prod", "Product", { snippet: "\\prod_{▯}^{▯}", keywords: "pi multiply" }],
  ["\\coprod", "Coproduct", { snippet: "\\coprod_{▯}^{▯}" }],
  [
    "\\int",
    "Integral",
    { snippet: "\\int_{▯}^{▯}", common: true, keywords: "integrate area antiderivative" },
  ],
  ["\\iint", "Double integral", { snippet: "\\iint_{▯}", keywords: "integrate surface" }],
  ["\\iiint", "Triple integral", { snippet: "\\iiint_{▯}", keywords: "integrate volume" }],
  ["\\oint", "Contour integral", { snippet: "\\oint_{▯}", keywords: "integrate closed line" }],
  ["\\bigcup", "Union of many", { snippet: "\\bigcup_{▯}^{▯}", keywords: "set" }],
  ["\\bigcap", "Intersection of many", { snippet: "\\bigcap_{▯}^{▯}", keywords: "set" }],
  ["\\bigoplus", "Direct sum of many", { snippet: "\\bigoplus_{▯}" }],
  ["\\bigotimes", "Tensor product of many", { snippet: "\\bigotimes_{▯}" }],
  ["\\bigvee", "Or of many", { snippet: "\\bigvee_{▯}" }],
  ["\\bigwedge", "And of many", { snippet: "\\bigwedge_{▯}" }],
];

const fonts: Row[] = [
  [
    "\\mathbb",
    "Blackboard bold",
    {
      snippet: "\\mathbb{▯}",
      preview: "\\mathbb{R}",
      common: true,
      keywords: "reals naturals integers number set double struck",
    },
  ],
  ["\\mathbf", "Bold", { snippet: "\\mathbf{▯}", preview: "\\mathbf{v}", keywords: "vector" }],
  [
    "\\boldsymbol",
    "Bold symbol",
    { snippet: "\\boldsymbol{▯}", preview: "\\boldsymbol{\\mu}", keywords: "bold greek" },
  ],
  ["\\mathit", "Italic", { snippet: "\\mathit{▯}", preview: "\\mathit{diff}" }],
  [
    "\\mathrm",
    "Upright",
    { snippet: "\\mathrm{▯}", preview: "\\mathrm{d}x", keywords: "roman units" },
  ],
  [
    "\\mathcal",
    "Calligraphic",
    { snippet: "\\mathcal{▯}", preview: "\\mathcal{L}", keywords: "script laplace" },
  ],
  ["\\mathscr", "Script", { snippet: "\\mathscr{▯}", preview: "\\mathscr{F}" }],
  [
    "\\mathfrak",
    "Fraktur",
    { snippet: "\\mathfrak{▯}", preview: "\\mathfrak{g}", keywords: "gothic lie algebra" },
  ],
  [
    "\\frak",
    "Fraktur, short form",
    { snippet: "\\frak{▯}", preview: "\\frak{g}", keywords: "gothic" },
  ],
  ["\\mathsf", "Sans serif", { snippet: "\\mathsf{▯}", preview: "\\mathsf{A}" }],
  [
    "\\mathtt",
    "Typewriter",
    { snippet: "\\mathtt{▯}", preview: "\\mathtt{x}", keywords: "monospace code" },
  ],
  [
    "\\text",
    "Plain text",
    { snippet: "\\text{▯}", preview: "\\text{if } x", common: true, keywords: "words roman" },
  ],
  ["\\textbf", "Bold text", { snippet: "\\textbf{▯}", preview: "\\textbf{note}" }],
  [
    "\\displaystyle",
    "Display size",
    { preview: "\\displaystyle\\sum_{i=1}^n", keywords: "big style" },
  ],
  [
    "\\color",
    "Colour",
    { snippet: "\\color{▯}{▯}", preview: "\\color{orange}{x}", keywords: "red blue highlight" },
  ],
  [
    "\\boxed",
    "Boxed",
    { snippet: "\\boxed{▯}", preview: "\\boxed{x=2}", keywords: "frame answer" },
  ],
  [
    "\\cancel",
    "Struck through",
    { snippet: "\\cancel{▯}", preview: "\\cancel{x}", keywords: "cross out simplify" },
  ],
];

const spacing: Row[] = [
  ["\\,", "Thin space", { preview: "a\\,b" }],
  ["\\:", "Medium space", { preview: "a\\:b" }],
  ["\\;", "Thick space", { preview: "a\\;b" }],
  ["\\!", "Negative thin space", { preview: "a\\!b", keywords: "tighten" }],
  ["\\quad", "Quad space", { preview: "a\\quad b", common: true, keywords: "gap em" }],
  ["\\qquad", "Double quad space", { preview: "a\\qquad b", keywords: "gap" }],
  [
    "\\hspace",
    "Space of a given width",
    { snippet: "\\hspace{▯}", preview: "a\\hspace{1em}b", keywords: "gap horizontal" },
  ],
  [
    "\\phantom",
    "Invisible, taking its room",
    { snippet: "\\phantom{▯}", preview: "a\\phantom{xx}b", keywords: "align" },
  ],
];

const env = (
  name: string,
  meaning: string,
  body: string,
  extra: Partial<LatexCommand> = {},
): Row => [
  `\\begin{${name}}`,
  meaning,
  { snippet: `\\begin{${name}} ${body} \\end{${name}}`, ...extra },
];

const environments: Row[] = [
  env("pmatrix", "Matrix in parentheses", "▯ & ▯ \\\\", {
    common: true,
    preview: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    keywords: "matrix vector",
  }),
  env("bmatrix", "Matrix in brackets", "▯ & ▯ \\\\", {
    preview: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}",
    keywords: "matrix",
  }),
  env("vmatrix", "Determinant", "▯ & ▯ \\\\", {
    preview: "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}",
    keywords: "matrix det",
  }),
  env("matrix", "Matrix, no brackets", "▯ & ▯ \\\\", {
    preview: "\\begin{matrix} a & b \\\\ c & d \\end{matrix}",
    keywords: "grid",
  }),
  env("cases", "Cases", "▯ & ▯ \\\\", {
    common: true,
    preview: "\\begin{cases} 1 & x>0 \\\\ 0 & x\\le 0 \\end{cases}",
    keywords: "piecewise brace",
  }),
  env("aligned", "Aligned lines", "▯ &= ▯ \\\\", {
    preview: "\\begin{aligned} a &= b \\\\ &= c \\end{aligned}",
    keywords: "align equations steps",
  }),
  env("array", "Array with columns", "▯ & ▯ \\\\", {
    snippet: "\\begin{array}{cc} ▯ & ▯ \\\\ \\end{array}",
    preview: "\\begin{array}{cc} a & b \\\\ c & d \\end{array}",
    keywords: "table",
  }),
];

const chemistry: Row[] = [
  [
    "\\ce",
    "A chemical formula or equation",
    {
      snippet: "\\ce{▯}",
      preview: "\\ce{H2O}",
      common: true,
      keywords: "mhchem reaction molecule chemistry",
    },
  ],
  [
    "\\pu",
    "A physical unit",
    { snippet: "\\pu{▯}", preview: "\\pu{9.81 m/s^2}", keywords: "mhchem unit quantity si" },
  ],
];

export const COMMANDS: readonly LatexCommand[] = [
  ...rows("Greek", greek),
  ...rows("Operators", operators),
  ...rows("Relations", relations),
  ...rows("Arrows", arrows),
  ...rows("Accents", accents),
  ...rows("Delimiters", delimiters),
  ...rows("Big operators", big),
  ...rows("Fonts", fonts),
  ...rows("Spacing", spacing),
  ...rows("Environments", environments),
  ...rows("Chemistry", chemistry),
];

/** What a command's render shows: its sample, or its snippet with each slot a box. */
export function previewOf(command: LatexCommand): string {
  return command.preview ?? command.snippet.replaceAll("▯", "\\square");
}

/** Whether the command has slots to fill. */
export const hasSlots = (command: LatexCommand) => command.snippet.includes("▯");

const macroLists = new WeakMap<readonly Macro[], LatexCommand[]>();

/**
 * The Deck's Macros as commands, in the "Macros" group: each inserts a slot
 * per argument, renders with sample arguments, and means its definition.
 * Kept per list, so each keeps its identity while the Macros stay the same.
 */
export function macroCommands(macros: readonly Macro[]): LatexCommand[] {
  let commands = macroLists.get(macros);
  if (commands === undefined) {
    commands = macros.map(({ name, definition }) => {
      const arity = macroArity(definition);
      return {
        name,
        snippet: `${name}${"{▯}".repeat(arity)}`,
        group: "Macros",
        meaning: definition,
        preview: sampleOf(name, arity),
      };
    });
    macroLists.set(macros, commands);
  }
  return commands;
}

/** Every command there is with `macros`: the Macros first, in place of KaTeX's of their names. */
function commandsWith(macros: readonly Macro[]): LatexCommand[] {
  if (macros.length === 0) return [...COMMANDS];
  const names = new Set(macros.map((macro) => macro.name));
  return [...macroCommands(macros), ...COMMANDS.filter((command) => !names.has(command.name))];
}

/**
 * The commands whose name starts with `typed` (a `\` and letters), best
 * first, the Deck's `macros` among them.
 */
export function matching(typed: string, macros: readonly Macro[] = NO_MACROS): LatexCommand[] {
  const lower = typed.toLowerCase();
  return commandsWith(macros)
    .map((command, i) => ({ command, i }))
    .filter(({ command }) => command.name.toLowerCase().startsWith(lower))
    .toSorted(
      (a, b) =>
        Number(b.command.name === typed) - Number(a.command.name === typed) ||
        Number(b.command.name.startsWith(typed)) - Number(a.command.name.startsWith(typed)) ||
        Number(b.command.common ?? false) - Number(a.command.common ?? false) ||
        a.command.name.length - b.command.name.length ||
        a.i - b.i,
    )
    .map(({ command }) => command);
}

/**
 * The commands the cheatsheet's search finds, the Deck's `macros` among
 * them: by name, keyword and meaning (a Macro's definition).
 */
export function search(query: string, macros: readonly Macro[] = NO_MACROS): LatexCommand[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const all = commandsWith(macros);
  if (words.length === 0) return all;
  return all.filter((command) => {
    const hay =
      `${command.name} ${command.meaning} ${command.keywords ?? ""} ${command.group}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

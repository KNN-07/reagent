/**
 * Dependency checker for optional external tools.
 *
 * Checks for Lean 4 and LaTeX (tectonic or pdflatex) at startup.
 * Non-blocking: emits warnings to stderr, does not exit.
 * When a dependency is missing, prints platform-specific install instructions.
 */

import { $ } from "bun";
import chalk from "chalk";

export interface DependencyStatus {
	lean: { available: boolean; version?: string };
	latex: { available: boolean; binary?: string; version?: string };
	exa: { configured: boolean };
}

async function checkBinary(bin: string, versionFlag = "--version"): Promise<string | null> {
	try {
		const result = await $`${bin} ${versionFlag}`.quiet().nothrow();
		if (result.exitCode === 0) {
			return result.text().trim().split("\n")[0] ?? "";
		}
		return null;
	} catch {
		return null;
	}
}

function printInstallGuide(dep: "lean" | "tectonic" | "pdflatex"): void {
	const isWin = process.platform === "win32";
	const isMac = process.platform === "darwin";

	const guides: Record<string, { win: string; mac: string; linux: string; official: string }> = {
		lean: {
			official: "https://leanprover.github.io/lean4/doc/quickstart.html",
			win: "winget install leanprover.elan\nelan install leanprover/lean4:stable",
			mac: "brew install elan-init\nelan install leanprover/lean4:stable",
			linux: "curl -sSf https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh\nelan install leanprover/lean4:stable",
		},
		tectonic: {
			official: "https://tectonic-typesetting.github.io/en-US/install.html",
			win: "winget install tectonic-typesetting.tectonic",
			mac: "brew install tectonic",
			linux: "curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh",
		},
		pdflatex: {
			official: "https://www.latex-project.org/get/",
			win: "winget install MiKTeX.MiKTeX",
			mac: "brew install --cask mactex-no-gui",
			linux: "sudo apt-get install -y texlive-full  # or: sudo dnf install texlive-scheme-full",
		},
	};

	const g = guides[dep]!;
	const cmd = isWin ? g.win : isMac ? g.mac : g.linux;

	process.stderr.write(
		chalk.yellow(`\n[ReAgent] ${dep} not found. Install with:\n`) +
			chalk.dim(`  ${cmd.replace(/\n/g, "\n  ")}\n`) +
			chalk.dim(`  docs: ${g.official}\n`),
	);
}

export async function checkDependencies(): Promise<DependencyStatus> {
	const [leanVersion, tectonicVersion, pdflatexVersion] = await Promise.all([
		checkBinary("lean", "--version"),
		checkBinary("tectonic", "--version"),
		checkBinary("pdflatex", "--version"),
	]);

	const lean = {
		available: leanVersion !== null,
		version: leanVersion ?? undefined,
	};

	// Prefer tectonic (self-contained), fall back to pdflatex
	const latex = tectonicVersion
		? { available: true, binary: "tectonic", version: tectonicVersion }
		: pdflatexVersion
			? { available: true, binary: "pdflatex", version: pdflatexVersion }
			: { available: false };

	const exa = {
		configured: !!(Bun.env.EXA_API_KEY ?? Bun.env.EXASEARCH_API_KEY),
	};

	// Emit non-fatal warnings for missing optional dependencies
	if (!lean.available) {
		printInstallGuide("lean");
		process.stderr.write(
			chalk.dim(
				"  Lean 4 is optional — math proof verification in /autopaper will be skipped.\n",
			),
		);
	}

	if (!latex.available) {
		process.stderr.write(
			chalk.yellow(
				"\n[ReAgent] No LaTeX compiler found. PDF compilation will be unavailable.\n",
			),
		);
		printInstallGuide("tectonic"); // recommend tectonic as simpler option
		process.stderr.write(
			chalk.dim("  Alternatively, you can compile the generated .tex source manually.\n"),
		);
	}

	if (!exa.configured) {
		process.stderr.write(
			chalk.dim(
				"\n[ReAgent] EXA_API_KEY not set — exa deep research tools will be unavailable.\n" +
					"  Get a key at https://exa.ai and set EXA_API_KEY in your environment.\n",
			),
		);
	}

	return { lean, latex, exa };
}

/**
 * Get the LaTeX binary to use for PDF compilation.
 * Returns null if neither tectonic nor pdflatex is available.
 */
export async function getLatexBinary(): Promise<"tectonic" | "pdflatex" | null> {
	const tectonic = await checkBinary("tectonic", "--version");
	if (tectonic) return "tectonic";
	const pdflatex = await checkBinary("pdflatex", "--version");
	if (pdflatex) return "pdflatex";
	return null;
}

/**
 * Returns true if Lean 4 CLI is available on PATH.
 */
export async function isLeanAvailable(): Promise<boolean> {
	return (await checkBinary("lean", "--version")) !== null;
}

/**
 * /survey workflow — types and shared state
 */

export interface SurveyScope {
	topic: string;
	keywords: string[];
	timeRange: { from: number; to: number };
	venues: string[];
	depth: "overview" | "technical";
	latexTemplate: "ieee" | "acl" | "neurips" | "icml" | "iclr";
	outputDir: string;
}

export interface VerifiedPaper {
	title: string;
	authors: string[];
	year: number;
	venue: string;
	abstract: string;
	bibtex: string;
	url: string;
	verified: boolean;
	relevance: "high" | "medium" | "low";
}

export interface PaperCluster {
	name: string;
	synthesis: string;
	paperKeys: string[];
}

export interface ResearchResult {
	papers: VerifiedPaper[];
	clusters: PaperCluster[];
	openProblems: string[];
	totalFound: number;
	totalVerified: number;
}

export interface SurveyOutput {
	scope: SurveyScope;
	research: ResearchResult;
	outputDir: string;
	/** Paths to generated files */
	files: {
		latex?: string;
		pdf?: string;
		bib?: string;
		summary?: string;
	};
	/** Citation issues found during verification */
	citationIssues: string[];
	completedAt: string;
}

export const DEFAULT_SURVEY_SCOPE: Partial<SurveyScope> = {
	timeRange: { from: 2020, to: new Date().getFullYear() },
	venues: ["arXiv", "NeurIPS", "ICML", "ICLR", "ACL", "EMNLP", "IEEE", "Nature"],
	depth: "technical",
	latexTemplate: "ieee",
};

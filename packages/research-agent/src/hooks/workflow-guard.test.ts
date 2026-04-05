/**
 * Unit tests for the workflow guard.
 *
 * Tests phase detection, tool blocking logic, and output validation
 * without requiring a real agent session.
 */

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@reagent/ra-agent-core";
import { detectPhaseTransition, extractMessageText, findPhaseTrigger } from "./phase-detector";
import { validateWorkflowOutputs } from "./output-validator";
import { detectWorkflow, initialPhase, PHASE_BLOCKED_TOOLS } from "./workflow-state";

// ============================================================================
// Helpers
// ============================================================================

function makeMsg(text: string, role: "assistant" | "user" = "assistant") {
	// Using `as unknown as AgentMessage` to construct a minimal test message
	// that matches the shape expected by our pure functions.
	return {
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as unknown as import("@reagent/ra-agent-core").AgentMessage;
}

// ============================================================================
// extractMessageText
// ============================================================================

describe("extractMessageText", () => {
	test("extracts text from text content array", () => {
		const msg = makeMsg("hello world");
		expect(extractMessageText(msg)).toBe("hello world");
	});

	test("concatenates multiple text parts", () => {
		const msg: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "Part one." },
				{ type: "text", text: "Part two." },
			],
			timestamp: Date.now(),
		} as AgentMessage;
		const text = extractMessageText(msg);
		expect(text).toContain("Part one.");
		expect(text).toContain("Part two.");
	});

	test("returns empty string for non-text content", () => {
		const msg: AgentMessage = {
			role: "assistant",
			content: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "" } }],
			timestamp: Date.now(),
		} as unknown as AgentMessage;
		expect(extractMessageText(msg)).toBe("");
	});
});

// ============================================================================
// detectWorkflow
// ============================================================================

describe("detectWorkflow", () => {
	test("detects /survey from system prompt injection", () => {
		expect(detectWorkflow("You are running the ReAgent /survey workflow. Your goal is...")).toBe("survey");
	});

	test("detects /autoresearch from system prompt injection", () => {
		expect(detectWorkflow("You are running the ReAgent /autoresearch workflow — automated ML")).toBe("autoresearch");
	});

	test("detects /autopaper from system prompt injection", () => {
		expect(detectWorkflow("You are running the ReAgent /autopaper workflow — end-to-end")).toBe("autopaper");
	});

	test("detects /survey from direct command", () => {
		expect(detectWorkflow("/survey quantum computing trends")).toBe("survey");
	});

	test("detects /autoresearch from direct command", () => {
		expect(detectWorkflow("/autoresearch")).toBe("autoresearch");
	});

	test("detects /autopaper from direct command", () => {
		expect(detectWorkflow("/autopaper write a paper on transformers")).toBe("autopaper");
	});

	test("returns null for unrelated prompts", () => {
		expect(detectWorkflow("help me write some code")).toBeNull();
		expect(detectWorkflow("/review this paper")).toBeNull();
	});
});

// ============================================================================
// initialPhase
// ============================================================================

describe("initialPhase", () => {
	test("survey starts at interview", () => {
		expect(initialPhase("survey")).toBe("interview");
	});

	test("autoresearch starts at setup", () => {
		expect(initialPhase("autoresearch")).toBe("setup");
	});

	test("autopaper starts at intake", () => {
		expect(initialPhase("autopaper")).toBe("intake");
	});
});

// ============================================================================
// findPhaseTrigger
// ============================================================================

describe("findPhaseTrigger", () => {
	test("finds survey phase 1→2 trigger", () => {
		const trigger = findPhaseTrigger("**Starting research phase...**", "survey");
		expect(trigger).not.toBeNull();
		expect(trigger?.nextPhase).toBe("research");
	});

	test("finds survey phase 2→3 trigger", () => {
		const trigger = findPhaseTrigger("Research complete. Writing survey...", "survey");
		expect(trigger).not.toBeNull();
		expect(trigger?.nextPhase).toBe("writing");
	});

	test("finds autoresearch baseline trigger", () => {
		const trigger = findPhaseTrigger("Running baseline experiment now.", "autoresearch");
		expect(trigger).not.toBeNull();
		expect(trigger?.nextPhase).toBe("baseline");
	});

	test("finds autoresearch loop trigger", () => {
		const trigger = findPhaseTrigger("Entering Improvement Loop iteration 1.", "autoresearch");
		expect(trigger).not.toBeNull();
		expect(trigger?.nextPhase).toBe("loop");
	});

	test("returns null for unrelated text", () => {
		const trigger = findPhaseTrigger("I will help you with your research.", "survey");
		expect(trigger).toBeNull();
	});

	test("does not match triggers for other workflows", () => {
		// autoresearch triggers should not match when active workflow is survey
		const trigger = findPhaseTrigger("Running baseline experiment now.", "survey");
		expect(trigger).toBeNull();
	});
});

// ============================================================================
// detectPhaseTransition
// ============================================================================

describe("detectPhaseTransition", () => {
	test("returns null for user messages", () => {
		const msg = makeMsg("Starting research phase...", "user");
		expect(detectPhaseTransition(msg, "survey", "interview")).toBeNull();
	});

	test("returns null when already in the target phase", () => {
		const msg = makeMsg("Starting research phase...");
		expect(detectPhaseTransition(msg, "survey", "research")).toBeNull();
	});

	test("returns next phase for matching trigger in assistant message", () => {
		const msg = makeMsg("Great! **Starting research phase...**");
		expect(detectPhaseTransition(msg, "survey", "interview")).toBe("research");
	});

	test("returns null when no trigger matches", () => {
		const msg = makeMsg("I will now begin gathering sources.");
		expect(detectPhaseTransition(msg, "survey", "interview")).toBeNull();
	});
});

// ============================================================================
// PHASE_BLOCKED_TOOLS
// ============================================================================

describe("PHASE_BLOCKED_TOOLS", () => {
	test("survey interview phase blocks exa_researcher_start", () => {
		expect(PHASE_BLOCKED_TOOLS.survey.interview?.has("exa_researcher_start")).toBe(true);
	});

	test("survey research phase blocks write", () => {
		expect(PHASE_BLOCKED_TOOLS.survey.research?.has("write")).toBe(true);
	});

	test("survey writing phase does NOT block write", () => {
		expect(PHASE_BLOCKED_TOOLS.survey.writing?.has("write")).toBeFalsy();
	});

	test("autoresearch setup phase blocks bash", () => {
		expect(PHASE_BLOCKED_TOOLS.autoresearch.setup?.has("bash")).toBe(true);
	});

	test("autoresearch loop phase blocks nothing", () => {
		const blocked = PHASE_BLOCKED_TOOLS.autoresearch.loop;
		expect(!blocked || blocked.size === 0).toBe(true);
	});

	test("autopaper lean phase blocks write", () => {
		expect(PHASE_BLOCKED_TOOLS.autopaper.lean?.has("write")).toBe(true);
	});
});

// ============================================================================
// validateWorkflowOutputs
// ============================================================================

describe("validateWorkflowOutputs", () => {
	test("returns empty missing when outputDir is undefined", async () => {
		const result = await validateWorkflowOutputs("survey", undefined);
		expect(result.missing).toHaveLength(0);
	});

	test("returns empty missing when outputDir does not exist", async () => {
		const result = await validateWorkflowOutputs("survey", "/tmp/nonexistent-reagent-test-dir-xxx");
		expect(result.missing).toHaveLength(0);
	});

	test("returns missing files when directory exists but is empty", async () => {
		const dir = `/tmp/reagent-test-${Date.now()}`;
		await import("node:fs/promises").then(fs => fs.mkdir(dir, { recursive: true }));
		try {
			const result = await validateWorkflowOutputs("survey", dir);
			// Survey requires .tex, .bib, .md
			expect(result.missing.length).toBeGreaterThan(0);
		} finally {
			await import("node:fs/promises").then(fs => fs.rmdir(dir));
		}
	});
});

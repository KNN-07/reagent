/**
 * Process management utilities.
 */

import { setNativeKillTree } from "@reagent/ra-utils";
import { native } from "../native";

setNativeKillTree(native.killTree);

export const { killTree, listDescendants } = native;

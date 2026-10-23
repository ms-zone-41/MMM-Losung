import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import { configs as packageJsonConfigs } from "eslint-plugin-package-json";

export default defineConfig([
	{
		files: ["**/*.js", "**/*.mjs"],
		extends: [js.configs.recommended]
	},
	{
		// Runs in the browser of the mirror, with the globals of MagicMirror²
		files: ["MMM-Losung.js"],
		languageOptions: {
			sourceType: "script",
			globals: {
				...globals.browser,
				Log: "readonly",
				Module: "readonly"
			}
		}
	},
	{
		// Everything else runs in Node.js
		files: ["**/*.js"],
		ignores: ["MMM-Losung.js"],
		languageOptions: {
			sourceType: "commonjs",
			globals: globals.node
		}
	},
	packageJsonConfigs.recommended
]);

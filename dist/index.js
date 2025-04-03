"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const tesseract_js_1 = require("tesseract.js");
const body_parser_1 = __importDefault(require("body-parser"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json({ limit: "50mb" }));
app.get("/", (_req, res) => {
    res.send("Api is running");
});
app.post("/extract", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({
                success: false,
                data: null,
                message: "Please provide image data",
            });
        }
        try {
            // Updated regex to handle multi-line JSON
            const jsonMatch = imageBase64.match(/"name"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"organization"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"address"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"mobile"\s*:\s*"((?:[^"]|\\.)*)"/);
            if (jsonMatch) {
                const extractedData = {
                    name: jsonMatch[1], // Removed replacement
                    organization: jsonMatch[2], // Removed replacement
                    address: jsonMatch[3],
                    mobile: jsonMatch[4], // Removed replacement
                };
                return res.json({
                    success: true,
                    data: extractedData,
                    message: "Successfully extracted data",
                });
            }
        }
        catch (e) {
            console.log("Direct extraction failed, trying OCR");
        }
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, "base64");
        const worker = yield (0, tesseract_js_1.createWorker)();
        yield worker.loadLanguage("eng");
        yield worker.initialize("eng");
        yield worker.setParameters({
            tessedit_char_whitelist: "{}\":,.-_()'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+ ",
            tessedit_pageseg_mode: tesseract_js_1.PSM.SINGLE_BLOCK,
        });
        const { data: { text }, } = yield worker.recognize(imageBuffer);
        yield worker.terminate();
        const jsonText = improvedJsonExtract(text);
        const extractedData = JSON.parse(jsonText);
        // Removed all post-processing corrections
        return res.json({
            success: true,
            data: extractedData,
            message: "Successfully extracted data",
        });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            data: null,
            message: error.message,
        });
    }
}));
function improvedJsonExtract(text) {
    console.log("Raw OCR text:", text);
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const jsonCandidate = jsonMatch[0]
                .replace(/\s+/g, " ")
                .replace(/([''])/g, '"')
                .replace(/(\w+)\s*:/g, '"$1":')
                .replace(/:\s*([^",\{\}\[\]]+)(?=\s*[,\}])/g, ':"$1"');
            try {
                return JSON.stringify(JSON.parse(jsonCandidate));
            }
            catch (e) {
                console.log("Initial JSON parse failed:", e);
            }
        }
        // Simplified regex to capture entire values
        const nameMatch = text.match(/name["']?\s*:\s*["']([^"']*)["']/i);
        const orgMatch = text.match(/organization["']?\s*:\s*["']([^"']*)["']/i);
        const addressMatch = text.match(/address["']?\s*:\s*["']([^"']+)["']/i);
        const mobileMatch = text.match(/mobile["']?\s*:\s*["']([^"']+)["']/i);
        if (nameMatch || orgMatch || addressMatch || mobileMatch) {
            const result = {
                name: nameMatch ? nameMatch[1].trim() : "",
                organization: orgMatch ? orgMatch[1].trim() : "",
                address: addressMatch ? addressMatch[1].trim() : "",
                mobile: mobileMatch ? mobileMatch[1].trim() : "",
            };
            if (result.name &&
                result.organization &&
                result.address &&
                result.mobile) {
                return JSON.stringify(result);
            }
        }
        throw new Error("Could not extract JSON data from image");
    }
    catch (error) {
        throw new Error(`JSON extraction failed: ${error.message}`);
    }
}
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
exports.default = app;

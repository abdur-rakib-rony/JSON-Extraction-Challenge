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
                message: "please provide image data",
            });
        }
        const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, "base64");
        const worker = yield (0, tesseract_js_1.createWorker)();
        yield worker.loadLanguage("eng");
        yield worker.initialize("eng");
        yield worker.setParameters({
            tessedit_char_whitelist: '{}":,.-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+',
            tessedit_pageseg_mode: tesseract_js_1.PSM.SINGLE_BLOCK,
        });
        const { data: { text }, } = yield worker.recognize(imageBuffer);
        yield worker.terminate();
        const jsonText = improvedJsonExtract(text);
        const extractedData = JSON.parse(jsonText);
        return res.json({
            success: true,
            data: extractedData,
            message: "successfully extracted data",
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
    const standardMatch = text.match(/\{[\s\S]*\}/);
    if (standardMatch) {
        try {
            const jsonObj = JSON.parse(standardMatch[0]);
            return JSON.stringify(jsonObj);
        }
        catch (e) {
            console.log(e);
        }
    }
    try {
        const nameRegex = /"name"\s*:\s*"([^"]*)"/;
        const orgRegex = /"organization"\s*:\s*"([^"]*)"/;
        const addressRegex = /"address"\s*:\s*"([^"]*)"/;
        const mobileRegex = /"mobile"\s*:\s*"([^"]*)"/;
        const nameMatch = text.match(nameRegex);
        const orgMatch = text.match(orgRegex);
        const addressMatch = text.match(addressRegex);
        const mobileMatch = text.match(mobileRegex);
        if (nameMatch && orgMatch && addressMatch && mobileMatch) {
            const constructedJson = {
                name: nameMatch[1],
                organization: orgMatch[1],
                address: addressMatch[1],
                mobile: mobileMatch[1],
            };
            return JSON.stringify(constructedJson);
        }
        throw new Error("Invalid JSON pattern");
    }
    catch (error) {
        throw new Error(error.message);
    }
}
app.listen(port, () => {
    console.log(port);
});
exports.default = app;

"""Vision worker: denoise -> CNN-style conv feature maps -> ROI detection -> OCR.
The conv stage uses fixed Sobel/Laplacian/Gaussian kernels (a hand-set first convolutional layer +
ReLU + max-pool). Swap in a trained PyTorch/ONNX layout model at `feature_maps()` if you need one."""
import cv2, numpy as np, pytesseract
from fastapi import FastAPI, UploadFile, File, HTTPException

app = FastAPI(title="cnn-worker")

KERNELS = {
    "sobel_x": np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32),
    "sobel_y": np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], np.float32),
    "laplacian": np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], np.float32),
    "blur": np.ones((3, 3), np.float32) / 9,
}

def preprocess(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15), gray

def feature_maps(gray):
    g = cv2.resize(gray, (256, 256)).astype(np.float32) / 255.0
    out = {}
    for name, k in KERNELS.items():
        fm = np.maximum(cv2.filter2D(g, -1, k), 0)                         # conv + ReLU
        pooled = fm.reshape(16, 16, 16, 16).max(axis=(1, 3))               # 16x16 max-pool grid
        out[name] = {"mean": float(fm.mean()), "std": float(fm.std()), "grid": np.round(pooled, 3).tolist()}
    return out

def regions(binary):
    inv = 255 - binary
    dil = cv2.dilate(inv, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 9)), iterations=2)
    cnts, _ = cv2.findContours(dil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(c) for c in cnts]
    boxes = [b for b in boxes if b[2] * b[3] > 400]
    boxes.sort(key=lambda b: (b[1] // 40, b[0]))
    return [{"x": int(x), "y": int(y), "w": int(w), "h": int(h)} for x, y, w, h in boxes[:200]]

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/process")
async def process(file: UploadFile = File(...)):
    data = np.frombuffer(await file.read(), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Not a decodable image")
    binary, gray = preprocess(img)
    text = pytesseract.image_to_string(binary).strip()
    return {"text": text, "boxes": regions(binary), "features": feature_maps(gray),
            "size": {"w": img.shape[1], "h": img.shape[0]}}

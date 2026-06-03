# 🛣️ RoadPulse (Pothole Detector)

RoadPulse is a full-stack system designed to detect potholes using mobile sensors. It consists of an Android client application for data collection and a Node.js web application for monitoring and detection analysis.

---

## 📂 Project Structure

- **`PotholeDetector_Android/`**: The native Android application that handles sensor data collection and device integrations.
- **`PotholeDetector_Web/`**: The web dashboard and server back-end that acts as the primary user interface and AI analysis pipeline.

---

## ⚡ Start Guide

Follow these steps to run the RoadPulse application locally on your computer and access it from your mobile device.

### Step 1: Start the Local AI Service (Ollama)
Open a terminal and run the following command to start the Ollama AI service:
```bash
sudo systemctl start ollama
```

> [!TIP]
> If you want Ollama to always start automatically at boot time, run:
> ```bash
> sudo systemctl enable ollama
> ```

### Step 2: Start the Web Server
Open a new terminal window, navigate to the web project directory, and start the Node.js server:
```bash
cd PotholeDetector_Web
node server.js
```
*Keep this terminal open while using the application.*

### Step 3: Open the Web Application

#### 💻 On Your Laptop
Open your browser and navigate to:
[https://localhost:8443](https://localhost:8443)

#### 📱 On Your Mobile Phone
Ensure your phone and laptop are connected to the **same Wi-Fi network**. Open your phone's web browser and go to the IP address printed in the server's terminal startup logs, for example:
`https://<YOUR_LAPTOP_IP>:8443` (e.g., `https://10.34.128.82:8443`)

> [!IMPORTANT]
> **Bypassing the SSL Warning:**  
> Because the server uses a self-signed certificate (which is required to access mobile motion sensors in a secure context), your browser will display a security warning:
> - **Chrome (Laptop/Android):** Click **Advanced** ➔ **Proceed to ... (unsafe)**
> - **Safari (iPhone):** Click **Show Details** ➔ **Visit this website**

---

## 🛑 Stop Guide

### Step 1: Stop the Web Server
Go to the terminal where you ran `node server.js` and terminate the process:
```key
Ctrl + C
```

### Step 2: Free up the Port (If needed)
If you get an `EADDRINUSE` error when restarting the server, the port is still occupied by a background process. Free it by running:

```bash
fuser -k 8443/tcp
```

*Alternatively, you can use:*
```bash
kill -9 $(lsof -t -i:8443)
```

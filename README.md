
# 🤖 LocalMind AI

A personal AI chatbot built with React, TypeScript, Vite, and Ollama. LocalMind AI runs locally on your computer, allowing you to interact with a language model through a modern, responsive chat interface.

## ✨ Features

- 💬 AI-powered conversations using Ollama
- 🧠 Local Llama 3.2 1B language model
- 🎨 Modern dark-themed chat interface
- ⏳ Animated AI typing indicator
- 🖼️ Gallery image attachments
- 📷 Camera attachment option
- 📎 Document and file attachments
- 🎙️ Audio recording and playback
- 📱 Responsive chat layout
- 🔒 Local AI processing without a cloud AI API key

**Note:** Attachments can be selected and displayed in the chat. Full AI understanding of images, audio, and documents is planned for future development.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend interface |
| TypeScript | Type-safe development |
| Vite | Development and build tooling |
| CSS | Responsive styling |
| Ollama | Local AI inference |
| Llama 3.2 1B | Language model |
| Git & GitHub | Version control |

## 🚀 Getting Started

### Prerequisites

Install:

- Node.js and npm
- Ollama
- Git

### 1. Clone the repository

```bash
git clone https://github.com/MatalaSiongo/localmind-ai.git
cd localmind-ai
```

### 2. Install dependencies

```bash
npm install
```

### 3. Download the AI model

```bash
ollama pull llama3.2:1b
```

### 4. Start Ollama

Ensure Ollama is running on:

`http://localhost:11434`

The application uses Vite's development proxy to communicate with the Ollama API.

### 5. Start the application

```bash
npm run dev
```

Open the local URL displayed in your terminal, usually:

`http://localhost:5173`

## 💡 How It Works

1. The user enters a message in the React chat interface.
2. The application sends the conversation to Ollama through a local API proxy.
3. Ollama processes the request using Llama 3.2 1B.
4. The generated response appears in the chat.

LocalMind AI requires the Ollama service to be running for AI responses.

## 🖼️ Screenshots

Application screenshots will be added as the project develops.

## 🗺️ Roadmap

- [x] Build the React and TypeScript chatbot
- [x] Integrate Ollama
- [x] Create a modern chat interface
- [x] Add gallery, camera, and file attachment controls
- [x] Add audio recording
- [ ] Add AI image understanding
- [ ] Add speech-to-text transcription
- [ ] Add document reading and summarization
- [ ] Add conversation history persistence
- [ ] Improve error handling and accessibility
- [ ] Add automated tests

## 🔐 Privacy

LocalMind AI uses a locally running Ollama model for text generation. Text conversations do not require a cloud-based AI service.

The application is currently a development project and is not intended for handling sensitive information without further security review.

## 👨‍💻 Developer

**Francois Matala Siongo**

Mobile and software developer with an interest in artificial intelligence, cloud technologies, and modern application development.

**GitHub:** https://github.com/MatalaSiongo

## 📄 License

No open-source license has been selected yet. All rights reserved unless a license is added to the repository.

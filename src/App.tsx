
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Attachment = {
  id: string
  file: File
  previewUrl?: string
}

type Message = {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  apiContent?: string
  apiImages?: string[]
  isError?: boolean
}

type OllamaMessage = {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

type OllamaChunk = {
  message?: {
    content?: string
  }
  done?: boolean
  error?: string
}

const TEXT_MODEL = 'llama3.2:1b'
const VISION_MODEL = 'gemma3:4b'

const TRANSCRIPTION_API = 'http://127.0.0.1:8000/transcribe'
const MAX_MEDIA_SIZE = 25 * 1024 * 1024
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024
const MAX_DOCUMENT_CHARS = 12000
const MAX_RECENT_MESSAGES = 8

function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the image.'))
        return
      }

      const base64 = reader.result.split(',')[1]

      if (!base64) {
        reject(new Error('Image conversion failed.'))
        return
      }

      resolve(base64)
    }

    reader.onerror = () => {
      reject(new Error('Failed to load the image.'))
    }

    reader.readAsDataURL(file)
  })
}

function limitDocumentText(text: string): string {
  if (text.length <= MAX_DOCUMENT_CHARS) {
    return text
  }

  return (
    text.slice(0, MAX_DOCUMENT_CHARS) +
    '\n\n[Document truncated because it exceeds the reading limit.]'
  )
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())

  const task = pdfjsLib.getDocument({ data })
  const pdf = await task.promise

  const pages: string[] = []
  let totalCharacters = 0

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (totalCharacters >= MAX_DOCUMENT_CHARS) break

      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()

      const pageText = textContent.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')

      const remaining = MAX_DOCUMENT_CHARS - totalCharacters
      const selectedText = pageText.slice(0, remaining)

      pages.push(`Page ${pageNumber}:\n${selectedText}`)
      totalCharacters += selectedText.length

      page.cleanup()
    }
  } finally {
    await task.destroy()
  }

  const result = pages.join('\n\n').trim()

  if (!result) {
    throw new Error(
      `${file.name}: No readable text found. This may be a scanned PDF requiring OCR.`
    )
  }

  return limitDocumentText(result)
}

async function extractWordText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()

  const result = await mammoth.extractRawText({
    arrayBuffer,
  })

  const text = result.value.trim()

  if (!text) {
    throw new Error(
      `${file.name}: No readable text found in the Word document.`
    )
  }

  return limitDocumentText(text)
}

async function extractAttachmentText(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `${file.name} is too large. Maximum document size is 5 MB.`
    )
  }

  const extension = file.name.split('.').pop()?.toLowerCase()

  let text = ''

  if (extension === 'pdf') {
    text = await extractPdfText(file)
  } else if (extension === 'docx') {
    text = await extractWordText(file)
  } else if (extension === 'txt' || extension === 'md') {
    text = limitDocumentText(await file.text())
  } else {
    throw new Error(
      `${file.name}: Unsupported document format. Use PDF, DOCX, TXT or MD.`
    )
  }

  return `Document: ${file.name}\n\n${text}`
}

function isSpeechFile(file: File): boolean {
  return (
    file.type.startsWith('audio/') ||
    file.type.startsWith('video/') ||
    /\.(mp3|m4a|wav|webm|ogg|flac|mp4|mov|m4v)$/i.test(file.name)
  )
}

async function transcribeSpeech(file: File): Promise<string> {
  if (file.size > MAX_MEDIA_SIZE) {
    throw new Error(`${file.name}: audio/video must be 25 MB or smaller.`)
  }

  const formData = new FormData()
  formData.append('file', file, file.name)

  let response: Response
  try {
    response = await fetch(TRANSCRIPTION_API, {
      method: 'POST',
      body: formData,
    })
  } catch {
    throw new Error(
      'Could not reach the transcription service. Start the FastAPI server on port 8000 and try again.'
    )
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (typeof parsed.detail === 'string') detail = parsed.detail
    } catch {
      // Preserve the raw error message when the response is not JSON.
    }
    throw new Error(`${file.name}: transcription failed (${response.status}). ${detail}`)
  }

  const result = (await response.json()) as { text?: string; language?: string }
  const transcript = result.text?.trim()
  if (!transcript) {
    throw new Error(`${file.name}: no speech was detected.`)
  }
  return `Transcription of ${file.name}${result.language ? ` (language: ${result.language})` : ''}:\n${transcript}`
}

function buildHistory(
  messages: Message[],
  newImagesPresent: boolean
): {
  history: OllamaMessage[]
  useVision: boolean
} {
  const validMessages = messages.filter(
    message => !message.isError
  )

  const lastImageIndex = validMessages.findLastIndex(
    message => (message.apiImages?.length ?? 0) > 0
  )

  const recentStart = Math.max(
    0,
    validMessages.length - MAX_RECENT_MESSAGES
  )

  const history: OllamaMessage[] = validMessages
    .slice(recentStart)
    .map(message => ({
      role: message.role,
      content: message.apiContent ?? message.content,
    }))

  if (!newImagesPresent && lastImageIndex >= 0) {
    const imageMessage = validMessages[lastImageIndex]

    const imageHistoryMessage: OllamaMessage = {
      role: imageMessage.role,
      content: imageMessage.apiContent ?? imageMessage.content,
      images: imageMessage.apiImages,
    }

    if (lastImageIndex < recentStart) {
      history.unshift(imageHistoryMessage)
    } else {
      history[lastImageIndex - recentStart] = imageHistoryMessage
    }
  }

  return {
    history,
    useVision: newImagesPresent || lastImageIndex >= 0,
  }
}

function App() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null)

  const galleryRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const attachmentsRef = useRef<Attachment[]>([])
  const messagesRef = useRef<Message[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    messagesRef.current = messages

    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages, loading])

  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current
      void videoRef.current.play().catch(console.error)
    }
  }, [cameraOpen])

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      audioStreamRef.current?.getTracks().forEach(track => track.stop())
      cameraStreamRef.current?.getTracks().forEach(track => track.stop())

      const allAttachments = [
        ...attachmentsRef.current,
        ...messagesRef.current.flatMap(
          message => message.attachments || []
        ),
      ]

      allAttachments.forEach(attachment => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
    }
  }, [])

  function addFiles(files: File[]) {
    const validFiles: File[] = []
    const rejected: string[] = []

    for (const file of files) {
      if (
        file.type.startsWith('image/') &&
        file.size > MAX_IMAGE_SIZE
      ) {
        rejected.push(`${file.name}: image exceeds 10 MB`)
        continue
      }

      if (isSpeechFile(file) && file.size > MAX_MEDIA_SIZE) {
        rejected.push(`${file.name}: audio/video exceeds 25 MB`)
        continue
      }

      if (
        !file.type.startsWith('image/') &&
        !isSpeechFile(file) &&
        file.size > MAX_DOCUMENT_SIZE
      ) {
        rejected.push(`${file.name}: document exceeds 5 MB`)
        continue
      }

      validFiles.push(file)
    }

    const newAttachments: Attachment[] = validFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      previewUrl:
        file.type.startsWith('image/') ||
        isSpeechFile(file)
          ? URL.createObjectURL(file)
          : undefined,
    }))

    setAttachments(previous => [...previous, ...newAttachments])
    setMenuOpen(false)
    setMediaError(rejected.join('\n'))
  }

  function removeAttachment(id: string) {
    setAttachments(previous => {
      const selected = previous.find(item => item.id === id)

      if (selected?.previewUrl) {
        URL.revokeObjectURL(selected.previewUrl)
      }

      return previous.filter(item => item.id !== id)
    })
  }

  async function startRecording() {
    try {
      setMediaError('')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable.')
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Audio recording is not supported.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      audioStreamRef.current = stream
      audioChunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, {
          type: mimeType,
        })

        if (blob.size > 0) {
          const extension = mimeType.includes('mp4')
            ? 'm4a'
            : 'webm'

          const file = new File(
            [blob],
            `LocalMind-recording-${Date.now()}.${extension}`,
            { type: mimeType }
          )

          addFiles([file])
        }

        stream.getTracks().forEach(track => track.stop())
        audioStreamRef.current = null
        recorderRef.current = null
      }

      recorder.start()
      setRecording(true)
    } catch (error) {
      console.error(error)

      setMediaError(
        error instanceof Error
          ? error.message
          : 'Could not access microphone.'
      )

      audioStreamRef.current?.getTracks().forEach(track => track.stop())
      audioStreamRef.current = null
      setRecording(false)
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }

    setRecording(false)
  }

  async function openCamera() {
    setMenuOpen(false)

    try {
      setMediaError('')

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      })

      cameraStreamRef.current = stream
      setCameraOpen(true)
    } catch (error) {
      console.error(error)

      setMediaError(
        error instanceof Error
          ? error.message
          : 'Could not access camera.'
      )
    }
  }

  function closeCamera() {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop())
    cameraStreamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraOpen(false)
  }

  function takePhoto() {
    const video = videoRef.current

    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, 0, 0)

    canvas.toBlob(
      blob => {
        if (!blob) return

        const file = new File(
          [blob],
          `LocalMind-photo-${Date.now()}.jpg`,
          { type: 'image/jpeg' }
        )

        addFiles([file])
        closeCamera()
      },
      'image/jpeg',
      0.9
    )
  }

  async function sendMessage() {
    const question = input.trim()

    if (
      (!question && attachments.length === 0) ||
      sendingRef.current
    ) {
      return
    }

    sendingRef.current = true

    const selectedAttachments = [...attachments]
    const conversationHistory = [...messagesRef.current]

    const userMessage: Message = {
      role: 'user',
      content: question,
      attachments: selectedAttachments,
    }

    setMessages(previous => [...previous, userMessage])
    setInput('')
    setAttachments([])
    setMenuOpen(false)
    setMediaError('')
    setLoading(true)

    let assistantStarted = false
    let fullReply = ''

    try {
      const imageAttachments = selectedAttachments.filter(
        attachment => attachment.file.type.startsWith('image/')
      )

      const newImages = await Promise.all(
        imageAttachments.map(attachment =>
          imageToBase64(attachment.file)
        )
      )

      const documentAttachments = selectedAttachments.filter(
        attachment =>
          /\.(pdf|docx|txt|md)$/i.test(attachment.file.name)
      )

      const extractedTexts = await Promise.all(
        documentAttachments.map(attachment =>
          extractAttachmentText(attachment.file)
        )
      )

      const speechAttachments = selectedAttachments.filter(
        attachment => isSpeechFile(attachment.file)
      )

      const transcriptions = await Promise.all(
        speechAttachments.map(attachment =>
          transcribeSpeech(attachment.file)
        )
      )

      const unsupportedAttachments = selectedAttachments.filter(
        attachment =>
          !attachment.file.type.startsWith('image/') &&
          !isSpeechFile(attachment.file) &&
          !/\.(pdf|docx|txt|md)$/i.test(attachment.file.name)
      )

      const attachmentNotes = unsupportedAttachments.map(
        attachment =>
          `[Attachment: ${attachment.file.name}. Its contents cannot be analyzed yet.]`
      )

      const combinedContent = [
        question ||
          (newImages.length > 0
            ? 'Describe the attached image in detail.'
            : transcriptions.length > 0
              ? 'Respond to the following transcribed speech.'
              : 'Please summarize the attached document.'),
        ...extractedTexts,
        ...transcriptions,
        ...attachmentNotes,
      ].join('\n\n')

      const { history, useVision } = buildHistory(
        conversationHistory,
        newImages.length > 0
      )

      const selectedModel = useVision
        ? VISION_MODEL
        : TEXT_MODEL

      const apiMessages: OllamaMessage[] = [
        ...history,
        {
          role: 'user',
          content: combinedContent,
          ...(newImages.length > 0
            ? { images: newImages }
            : {}),
        },
      ]

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          stream: true,
          keep_alive: '10m',
          options: {
            num_predict: 512,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()

        throw new Error(
          `Ollama error ${response.status}: ${errorText}`
        )
      }

      if (!response.body) {
        throw new Error('Streaming is not available.')
      }

      setMessages(previous =>
        previous.map(message =>
          message === userMessage
            ? {
                ...message,
                apiContent: combinedContent,
                apiImages: newImages,
              }
            : message
        )
      )

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      let buffer = ''
      let streamFinished = false

      function processLine(line: string) {
        if (!line.trim()) return

        const chunk = JSON.parse(line) as OllamaChunk

        if (chunk.error) {
          throw new Error(chunk.error)
        }

        if (chunk.message?.content) {
          fullReply += chunk.message.content

          if (!assistantStarted) {
            assistantStarted = true

            setMessages(previous => [
              ...previous,
              {
                role: 'assistant',
                content: fullReply,
              },
            ])
          } else {
            setMessages(previous => {
              const updated = [...previous]
              const lastIndex = updated.length - 1

              if (
                lastIndex >= 0 &&
                updated[lastIndex].role === 'assistant'
              ) {
                updated[lastIndex] = {
                  ...updated[lastIndex],
                  content: fullReply,
                }
              }

              return updated
            })
          }
        }

        if (chunk.done) {
          streamFinished = true
        }
      }

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, {
          stream: true,
        })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          processLine(line)
        }
      }

      buffer += decoder.decode()

      if (buffer.trim()) {
        processLine(buffer)
      }

      if (!streamFinished) {
        throw new Error('The response stream ended early.')
      }

      if (!assistantStarted) {
        setMessages(previous => [
          ...previous,
          {
            role: 'assistant',
            content: 'No response received from Ollama.',
          },
        ])
      }
    } catch (error) {
      console.error('LocalMind AI error:', error)

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error.'

      setMediaError(errorMessage)

      if (assistantStarted) {
        setMessages(previous => {
          const updated = [...previous]
          const lastIndex = updated.length - 1

          if (
            lastIndex >= 0 &&
            updated[lastIndex].role === 'assistant'
          ) {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content:
                fullReply +
                '\n\n[Response interrupted. Please try again.]',
              isError: true,
            }
          }

          return updated
        })
      } else {
        setMessages(previous => [
          ...previous,
          {
            role: 'assistant',
            content:
              `Could not process your request: ${errorMessage}`,
            isError: true,
          },
        ])
      }
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  function toggleSpeech(messageIndex: number, text: string) {
    if (!('speechSynthesis' in window)) {
      setMediaError('Speech playback is not supported by this browser.')
      return
    }

    // Clicking the active speaker stops it; another speaker switches messages.
    window.speechSynthesis.cancel()
    speechRef.current = null
    if (speakingMessage === messageIndex) {
      setSpeakingMessage(null)
      return
    }

    // Strip common Markdown syntax so headings and formatting read naturally.
    const spokenText = text
      .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_#>~]/g, '')
      .trim()

    if (!spokenText) return
    const utterance = new SpeechSynthesisUtterance(spokenText)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onend = () => {
      if (speechRef.current === utterance) {
        speechRef.current = null
        setSpeakingMessage(null)
      }
    }
    utterance.onerror = event => {
      if (speechRef.current === utterance) {
        speechRef.current = null
        setSpeakingMessage(null)
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          setMediaError(`Speech playback failed: ${event.error}`)
        }
      }
    }
    speechRef.current = utterance
    setMediaError('')
    setSpeakingMessage(messageIndex)
    window.speechSynthesis.speak(utterance)
  }

  function renderAttachments(
    items: Attachment[],
    removable = false
  ) {
    return (
      <div className="attachments-preview">
        {items.map(attachment => (
          <div className="attachment-card" key={attachment.id}>
            {attachment.file.type.startsWith('image/') &&
              attachment.previewUrl && (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.file.name}
                />
              )}

            {attachment.file.type.startsWith('audio/') &&
              attachment.previewUrl && (
                <audio controls src={attachment.previewUrl} />
              )}

            {attachment.file.type.startsWith('video/') &&
              attachment.previewUrl && (
                <video controls preload="metadata" src={attachment.previewUrl} />
              )}

            <span className="attachment-name">
              {attachment.file.name}
            </span>

            {removable && (
              <button
                type="button"
                className="remove-attachment"
                onClick={() => removeAttachment(attachment.id)}
                aria-label={`Remove ${attachment.file.name}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>🤖 LocalMind AI</h1>
        <p>Your personal AI assistant, running locally.</p>
      </header>

      <main className="chat-container">
        <div className="messages">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`message ${message.role}`}
            >
              <div className="message-content">
                <span className="message-icon">
                  {message.role === 'user' ? '👤' : '🤖'}
                </span>

                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>

              {message.role === 'assistant' && !message.isError && message.content.trim() && (
                <button
                  type="button"
                  onClick={() => toggleSpeech(index, message.content)}
                  aria-label={speakingMessage === index ? 'Stop reading response' : 'Read response aloud'}
                  title={speakingMessage === index ? 'Stop speaking' : 'Read aloud'}
                  aria-pressed={speakingMessage === index}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '8px',
                    padding: '6px 10px',
                    border: '1px solid rgba(160, 175, 210, 0.3)',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  <span aria-hidden="true">{speakingMessage === index ? '⏹️' : '🔊'}</span>
                  {speakingMessage === index ? 'Stop' : 'Listen'}
                </button>
              )}

              {message.attachments &&
                message.attachments.length > 0 &&
                renderAttachments(message.attachments)}
            </div>
          ))}

          {loading && (
            <div className="message assistant">
              🤖 LocalMind is thinking
              <span className="typing-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {mediaError && (
          <p className="media-error" role="alert">
            {mediaError}
          </p>
        )}

        {cameraOpen && (
          <div className="camera-panel">
            <video ref={videoRef} autoPlay playsInline muted />

            <div className="camera-actions">
              <button type="button" onClick={takePhoto}>
                📸 Take Photo
              </button>

              <button type="button" onClick={closeCamera}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={event => {
            addFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />

        <input
          ref={filesRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.mp3,.m4a,.wav,.webm,.ogg,.flac,.mp4,.mov,.m4v,audio/*,video/*"
          multiple
          hidden
          onChange={event => {
            addFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />

        <div className="composer">
          {attachments.length > 0 &&
            renderAttachments(attachments, true)}

          <form
            className="composer-form"
            onSubmit={event => {
              event.preventDefault()
              void sendMessage()
            }}
          >
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="Ask LocalMind anything..."
              rows={2}
              disabled={loading}
              onKeyDown={event => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />

            <div className="composer-toolbar">
              <div className="composer-left">
                <button
                  type="button"
                  className="plus-button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  aria-label="Add attachment"
                  aria-expanded={menuOpen}
                >
                  +
                </button>

                {menuOpen && (
                  <div className="attachment-menu">
                    <button
                      type="button"
                      onClick={() => galleryRef.current?.click()}
                    >
                      🖼️ Gallery
                    </button>

                    <button
                      type="button"
                      onClick={() => void openCamera()}
                    >
                      📷 Camera
                    </button>

                    <button
                      type="button"
                      onClick={() => filesRef.current?.click()}
                    >
                      📎 Files
                    </button>
                  </div>
                )}
              </div>

              <div className="composer-right">
                <button
                  type="button"
                  className={`mic-button ${
                    recording ? 'recording' : ''
                  }`}
                  onClick={() => {
                    if (recording) {
                      stopRecording()
                    } else {
                      void startRecording()
                    }
                  }}
                  title={
                    recording
                      ? 'Stop recording'
                      : 'Record audio'
                  }
                  aria-label={
                    recording
                      ? 'Stop recording'
                      : 'Record audio'
                  }
                >
                  {recording ? '⏹️' : '🎤'}
                </button>

                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    loading ||
                    (!input.trim() && attachments.length === 0)
                  }
                  aria-label="Send message"
                >
                  ↑
                </button>
              </div>
            </div>
          </form>
        </div>

        {recording && (
          <p className="recording-status">
            🔴 Recording audio... Press stop when finished.
          </p>
        )}
      </main>
    </div>
  )
}

export default App

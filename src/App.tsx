
import { useEffect, useRef, useState } from 'react'
import './App.css'

type Attachment = {
  id: string
  file: File
  previewUrl?: string
}

type Message = {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
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
      audioStreamRef.current?.getTracks().forEach(track => track.stop())
      cameraStreamRef.current?.getTracks().forEach(track => track.stop())

      const allAttachments = [
        ...attachmentsRef.current,
        ...messagesRef.current.flatMap(message => message.attachments || []),
      ]

      allAttachments.forEach(attachment => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
    }
  }, [])

  function addFiles(files: File[]) {
    const newAttachments: Attachment[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      previewUrl:
        file.type.startsWith('image/') ||
        file.type.startsWith('audio/')
          ? URL.createObjectURL(file)
          : undefined,
    }))

    setAttachments(previous => [...previous, ...newAttachments])
    setMenuOpen(false)
    setMediaError('')
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

    canvas.toBlob(blob => {
      if (!blob) return

      const file = new File(
        [blob],
        `LocalMind-photo-${Date.now()}.jpg`,
        { type: 'image/jpeg' }
      )

      addFiles([file])
      closeCamera()
    }, 'image/jpeg', 0.9)
  }

  async function sendMessage() {
    const question = input.trim()

    if ((!question && attachments.length === 0) || loading) {
      return
    }

    const selectedAttachments = [...attachments]

    const userMessage: Message = {
      role: 'user',
      content: question,
      attachments: selectedAttachments,
    }

    const updatedMessages = [...messages, userMessage]

    setMessages(updatedMessages)
    setInput('')
    setAttachments([])
    setMenuOpen(false)
    setLoading(true)

    try {
      const textFiles = selectedAttachments.filter(attachment =>
        /\.(txt|md)$/i.test(attachment.file.name)
      )

      const extractedTexts = await Promise.all(
        textFiles.map(async attachment => {
          if (attachment.file.size > 100_000) {
            return `[${attachment.file.name}: too large to read]`
          }

          const text = await attachment.file.text()

          return `File: ${attachment.file.name}\n${text}`
        })
      )

      const unsupportedFiles = selectedAttachments.filter(
        attachment => !/\.(txt|md)$/i.test(attachment.file.name)
      )

      const attachmentNotes = unsupportedFiles.map(
        attachment =>
          `[Attachment: ${attachment.file.name}. Its contents are not available to this text-only AI model.]`
      )

      const combinedContent = [
        question || 'Please review the attached content.',
        ...extractedTexts,
        ...attachmentNotes,
      ].join('\n\n')

      const apiMessages = [
        ...messages.map(message => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: 'user',
          content: combinedContent,
        },
      ]

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2:1b',
          messages: apiMessages,
          stream: false,
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`)
      }

      const data = await response.json()

      setMessages(previous => [
        ...previous,
        {
          role: 'assistant',
          content: data.message?.content || 'No response received.',
        },
      ])
    } catch (error) {
      console.error(error)

      setMessages(previous => [
        ...previous,
        {
          role: 'assistant',
          content:
            'Could not connect to Ollama. Please check that Ollama is running.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function renderAttachments(items: Attachment[]) {
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
                <audio
                  controls
                  src={attachment.previewUrl}
                />
              )}

            <span className="attachment-name">
              {attachment.file.name}
            </span>

            {items === attachments && (
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
              {message.role === 'user' ? '👤' : '🤖'}{' '}
              {message.content}

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
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
            />

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
          accept=".pdf,.txt,.md,.doc,.docx"
          multiple
          hidden
          onChange={event => {
            addFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />

        <div className="composer">
          {attachments.length > 0 &&
            renderAttachments(attachments)}

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
                if (event.key === 'Enter' && !event.shiftKey) {
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
                  className={`mic-button ${recording ? 'recording' : ''}`}
                  onClick={() => {
                    if (recording) {
                      stopRecording()
                    } else {
                      void startRecording()
                    }
                  }}
                  title={recording ? 'Stop recording' : 'Record audio'}
                  aria-label={recording ? 'Stop recording' : 'Record audio'}
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

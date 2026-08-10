import { io } from 'socket.io-client'
import { useState, useEffect } from 'react'
import { BACKEND_URL } from '../config/backend'

const socket = io(BACKEND_URL || window.location.origin)

function Chatbot() {
  const [messageList, setMessageList] = useState<string[]>([])
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    socket.on('message', (data: string) => {
      setMessageList((prev) => [...prev, data])
    })

    return () => {
      socket.off('message')
    }
  }, [])

  const sendMessage = () => {
    if (message.trim()) {
      setMessageList((prev) => [...prev, message])
      socket.emit('message', message)
    }
  }

  return (
    <>
      <input 
        type='text'
        value={message}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
      />
      <button onClick={sendMessage}>Send</button>

      <div>
        <h3>Messages:</h3>
        <ul>
          {messageList.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

export default Chatbot

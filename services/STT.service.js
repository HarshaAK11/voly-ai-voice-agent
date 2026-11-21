import dotenv from 'dotenv'
dotenv.config()

import { DeepgramClient } from "@deepgram/sdk"

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY })

export const speechToText = async (req, res) => {
  try {
    const result = await deepgram.auth.v1.tokens.grant()
    res.json(result)
  } catch (error) {
    console.error('Error generating token:', error)
    return res.status(500).json({ error: 'Failed to generate token' })    
  }
}
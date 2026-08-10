import dotenv from 'dotenv'
dotenv.config()

import { createClient } from "@deepgram/sdk"

const deepgram = createClient(process.env.DEEPGRAM_API_KEY)

export const speechToText = async (req, res) => {
  try {
    const { result, error } = await deepgram.auth.grantToken()
    if (error) throw error
    res.json(result)
  } catch (error) {
    console.error('Error generating token:', error)
    return res.status(500).json({ error: 'Failed to generate token' })    
  }
}
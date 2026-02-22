import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const app = express()
const port = process.env.API_PORT || 3001

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString()
  })
})

app.post('/detail-pages', (req, res) => {
  const { title, images = [] } = req.body || {}

  res.status(202).json({
    message: '상세페이지 생성 요청이 접수되었습니다.',
    request: {
      title: title || null,
      imageCount: Array.isArray(images) ? images.length : 0
    },
    next: 'TODO: 비동기 생성 파이프라인과 작업 상태 조회를 연결하세요.'
  })
})

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`)
})

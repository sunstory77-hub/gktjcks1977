import { Link, Route, Routes } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

function Home() {
  return (
    <section>
      <h1>Detail Page Builder</h1>
      <p>이미지를 업로드하고 에디터 화면에서 캔버스 미리보기를 확인하세요.</p>
      <Link to="/editor">/editor로 이동</Link>
    </section>
  )
}

function Editor() {
  const [imageSrc, setImageSrc] = useState(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f3f4f6'
    context.fillRect(0, 0, canvas.width, canvas.height)

    if (!imageSrc) {
      context.fillStyle = '#6b7280'
      context.font = '20px sans-serif'
      context.fillText('이미지를 업로드하면 미리보기가 표시됩니다.', 20, 60)
      return
    }

    const image = new Image()
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
    }
    image.src = imageSrc
  }, [imageSrc])

  const handleUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setImageSrc(reader.result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <section>
      <h1>Editor</h1>
      <p>상품 상세페이지용 대표 이미지를 미리 확인합니다.</p>
      <input type="file" accept="image/*" onChange={handleUpload} />
      <canvas ref={canvasRef} width={960} height={540} className="preview-canvas" />
      <Link to="/">홈으로</Link>
    </section>
  )
}

export default function App() {
  return (
    <main>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </main>
  )
}

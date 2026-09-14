const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload'

async function uploadImage(file) {
  const apiKey = process.env.IMGBB_API_KEY
  if (!apiKey) throw new Error('IMGBB_API_KEY sozlanmagan')

  const body = new FormData()
  body.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname)
  const response = await fetch(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', body })
  const result = await response.json()
  if (!response.ok || !result?.success) throw new Error(result?.error?.message || 'ImgBB’ga rasm yuklanmadi')
  return {
    url: result.data.url,
    displayUrl: result.data.display_url || result.data.url,
    thumbnailUrl: result.data.thumb?.url || result.data.url,
    deleteUrl: result.data.delete_url || '',
  }
}

export function uploadImages(files = []) {
  return Promise.all(files.map(uploadImage))
}

export async function deleteImage(image) {
  const deleteUrl = String(image?.deleteUrl || '')
  const match = /^https:\/\/ibb\.co\/([^/]+)\/([^/?#]+)$/.exec(deleteUrl)
  if (!match) return false

  const body = new FormData()
  body.append('pathname', `/${match[1]}/${match[2]}`)
  body.append('action', 'delete')
  body.append('delete', 'image')
  body.append('from', 'resource')
  body.append('deleting[id]', match[1])
  body.append('deleting[hash]', match[2])

  const response = await fetch('https://ibb.co/json', { method: 'POST', body })
  if (!response.ok) throw new Error(`ImgBB rasmini o‘chirishda xatolik: ${response.status}`)
  return true
}

export async function deleteImages(images = []) {
  const results = await Promise.allSettled(images.map(deleteImage))
  results.forEach((result) => {
    if (result.status === 'rejected') console.error(result.reason)
  })
}

/** Minimal image-gallery Host contract for RP component tests. */

import { useEffect, useState, type ReactNode } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

interface Labels {
  image: string
  openNamed(label: string): string
}

/** Render loaded image references as the accessible controls RP components rely on. */
export function ImageGallery({ images, load, labels }: {
  images: readonly { attachment: ImageAttachmentRef }[]
  load: (attachment: ImageAttachmentRef) => Promise<string>
  align: 'start' | 'end'
  labels: Labels
}): ReactNode {
  return images.length === 0 ? null : <div>{images.map(({ attachment }) =>
    <ImageButton key={attachment.attachmentId} attachment={attachment} load={load} labels={labels} />)}</div>
}

function ImageButton({ attachment, load, labels }: {
  attachment: ImageAttachmentRef
  load: (attachment: ImageAttachmentRef) => Promise<string>
  labels: Labels
}): ReactNode {
  const [source, setSource] = useState<string>()
  useEffect(() => {
    let active = true
    void load(attachment).then(value => { if (active) setSource(value) })
    return () => { active = false }
  }, [attachment, load])
  const name = attachment.name ?? labels.image
  return <button type="button" aria-label={labels.openNamed(name)}>
    {source === undefined ? name : <img src={source} alt={name} />}
  </button>
}

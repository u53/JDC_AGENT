interface Props {
  images: { data: string; mediaType: string }[]
  onRemove: (index: number) => void
}

export function ImagePreview({ images, onRemove }: Props) {
  if (images.length === 0) return null
  return (
    <div className="flex gap-2 px-3 py-2 border-t border-[#333]">
      {images.map((img, i) => (
        <div key={i} className="relative group">
          <img
            src={`data:${img.mediaType};base64,${img.data}`}
            className="h-16 w-16 object-cover border border-[#333]"
            alt={`Attached image ${i + 1}`}
          />
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-1 -right-1 w-4 h-4 bg-[#E61919] text-[#EAEAEA] text-[10px] rounded-full hidden group-hover:flex items-center justify-center"
            aria-label={`Remove image ${i + 1}`}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}

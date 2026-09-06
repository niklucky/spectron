export type GalleryImage = { url: string; alt: string; label: string };
export function ImageGallery({
  images,
  onImage,
}: {
  images: GalleryImage[];
  onImage: (url: string) => void;
}) {
  return (
    <div className="image-gallery">
      {images.map((image) => (
        <button
          key={image.url}
          onClick={() => onImage(image.url)}
          aria-label={image.label}
        >
          <img src={image.url} alt={image.alt} />
        </button>
      ))}
    </div>
  );
}

// Utilidades de imagen sin dependencia de almacenamiento (las fotos van a
// Supabase Storage, no a IndexedDB local).

// Comprime una imagen antes de subirla.
export function compressImage(file, maxSize = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxSize) { height = height * maxSize / width; width = maxSize; }
      else if (height > maxSize) { width = width * maxSize / height; height = maxSize; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen invalida')); };
    img.src = url;
  });
}

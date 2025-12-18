import { supabase } from '../lib/supabase';

/**
 * Upload an image file to Supabase Storage.
 * Returns the public URL of the uploaded image.
 */
export async function uploadDishPhoto(imageUri: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  // Generate a unique filename
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const fileExt = imageUri.split('.').pop()?.split('?')[0] || 'jpg';
  const fileName = `${user.id}/${timestamp}-${randomId}.${fileExt}`;

  // Read the file as a blob
  const response = await fetch(imageUri);
  const blob = await response.blob();

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('dish-photos')
    .upload(fileName, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  // Get the public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('dish-photos').getPublicUrl(data.path);

  return publicUrl;
}

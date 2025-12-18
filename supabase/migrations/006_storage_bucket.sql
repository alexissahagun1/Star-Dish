-- Star Dish MVP - Storage Bucket for Dish Photos

-- Create the dish-photos bucket if it doesn't exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dish-photos',
  'dish-photos',
  true, -- Public bucket so images can be accessed via public URLs
  5242880, -- 5MB file size limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS Policies for dish-photos bucket

-- Allow authenticated users to upload images
create policy "Authenticated users can upload dish photos"
  on storage.objects for insert
  with check (
    bucket_id = 'dish-photos' and
    auth.role() = 'authenticated'
  );

-- Allow authenticated users to update their own uploads
create policy "Users can update own dish photos"
  on storage.objects for update
  using (
    bucket_id = 'dish-photos' and
    auth.role() = 'authenticated' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to delete their own uploads
create policy "Users can delete own dish photos"
  on storage.objects for delete
  using (
    bucket_id = 'dish-photos' and
    auth.role() = 'authenticated' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read access (since bucket is public)
create policy "Anyone can read dish photos"
  on storage.objects for select
  using (bucket_id = 'dish-photos');

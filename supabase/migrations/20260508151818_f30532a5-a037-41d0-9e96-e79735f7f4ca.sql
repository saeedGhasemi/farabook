
create or replace function public.update_book_pages_partial(_book_id uuid, _patches jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  patch jsonb;
  cur jsonb;
  idx int;
  page jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_edit_book(auth.uid(), _book_id) then
    raise exception 'not_authorized';
  end if;

  select pages into cur from public.books where id = _book_id for update;
  if cur is null then cur := '[]'::jsonb; end if;

  for patch in select * from jsonb_array_elements(_patches) loop
    idx := (patch->>'index')::int;
    page := patch->'page';
    if page is null then continue; end if;
    -- pad array up to idx if needed
    while jsonb_array_length(cur) <= idx loop
      cur := cur || jsonb_build_array(jsonb_build_object('title','—','blocks','[]'::jsonb));
    end loop;
    cur := jsonb_set(cur, array[idx::text], page, true);
  end loop;

  update public.books
     set pages = cur,
         updated_at = now()
   where id = _book_id;
end;
$$;

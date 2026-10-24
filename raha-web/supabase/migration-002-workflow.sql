-- RAHA — migration 002: order / delivery workflow rules
-- Run ONCE in the Supabase SQL editor, after schema.sql.

-- 1. Riders may read the orders they deliver (helper avoids RLS recursion)
create function public.is_assigned_rider(o uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.deliveries d
    where d.order_id = o and d.rider_id = (select auth.uid())
  );
$$;

create policy "orders: assigned rider reads" on public.orders
  for select to authenticated
  using (public.is_assigned_rider(id));

-- 2. Merchants may only move an order along the allowed path, and only after
--    an admin has confirmed the bank transfer. Service role / admin / internal
--    trigger updates are not restricted.
create function public.guard_order_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if (select auth.uid()) is null or pg_trigger_depth() > 1 or public.is_admin() then
    return new;
  end if;

  if old.status = 'pending' and new.status = 'confirmed' then
    if old.payment_status <> 'paid' then
      raise exception 'Payment must be confirmed by RAHA before you accept this order.';
    end if;
    return new;
  end if;

  if (old.status = 'confirmed' and new.status in ('preparing', 'ready_for_pickup'))
     or (old.status = 'preparing' and new.status = 'ready_for_pickup') then
    return new;
  end if;

  raise exception 'Order status change % -> % is not allowed.', old.status, new.status;
end;
$$;

create trigger orders_guard_status
  before update of status on public.orders
  for each row execute function public.guard_order_status();

-- 3. Riders only change `status` (timestamps are set by the database), and only
--    along assigned -> picked_up -> (in_transit) -> delivered, and only once the
--    merchant has marked the order ready.
revoke update on public.deliveries from authenticated;
grant update (status) on public.deliveries to authenticated;

create function public.guard_delivery_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if (select auth.uid()) is not null and not public.is_admin() then
      if not (
        (old.status = 'assigned'   and new.status = 'picked_up') or
        (old.status = 'picked_up'  and new.status in ('in_transit', 'delivered')) or
        (old.status = 'in_transit' and new.status = 'delivered')
      ) then
        raise exception 'Delivery status change % -> % is not allowed.', old.status, new.status;
      end if;

      if new.status = 'picked_up' and not exists (
        select 1 from public.orders o
        where o.id = new.order_id and o.status = 'ready_for_pickup'
      ) then
        raise exception 'The shop has not marked this order ready for pickup yet.';
      end if;
    end if;

    if new.status = 'picked_up' then new.picked_up_at := coalesce(new.picked_up_at, now()); end if;
    if new.status = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  end if;
  return new;
end;
$$;

create trigger deliveries_guard_status
  before update of status on public.deliveries
  for each row execute function public.guard_delivery_status();

-- 4. Keep the order status in step with its delivery
create function public.sync_order_from_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('picked_up', 'in_transit') then
      update public.orders set status = 'out_for_delivery'
      where id = new.order_id and status in ('ready_for_pickup', 'out_for_delivery');
    elsif new.status = 'delivered' then
      update public.orders set status = 'delivered'
      where id = new.order_id and status in ('ready_for_pickup', 'out_for_delivery');
    end if;
  end if;
  return null;
end;
$$;

create trigger deliveries_sync_order
  after update of status on public.deliveries
  for each row execute function public.sync_order_from_delivery();

-- ---------------------------------------------------------------------------
-- Setting up people (run in the SQL editor after they have signed up in the app)
-- ---------------------------------------------------------------------------
-- Admin:
--   update public.users set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- Rider:
--   update public.users set role = 'rider'
--   where id = (select id from auth.users where email = 'rider@example.com');
-- Merchant (creates the shop, marks it approved, links the owner):
--   update public.users set role = 'merchant'
--   where id = (select id from auth.users where email = 'shop@example.com');
--   insert into public.merchants (owner_id, business_name, address, postcode, is_verified)
--   select id, 'Shop name', 'Shop street address', 'AA99H77BB55', true
--   from auth.users where email = 'shop@example.com';
--   (use the shop's real 11-character postcode, compact, no spaces)

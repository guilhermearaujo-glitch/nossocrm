import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const ORG_ID = '35cffcb4-b108-4023-9e7f-f5824e958031';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('x-webhook-secret');
  if (WEBHOOK_SECRET && authHeader !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await req.json();
  const { name, email, phone, source, pipeline } = body;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .insert({
      id: crypto.randomUUID(),
      organization_id: ORG_ID,
      name,
      email: email ?? null,
      phone: phone ?? null,
      custom_fields: { origem_lead: source ?? 'webhook' },
    })
    .select()
    .single();

  if (contactError) {
    return NextResponse.json({ error: contactError.message }, { status: 500 });
  }

  const boardName = pipeline === 'b2b' ? 'Pipeline B2B' : 'Pipeline B2C';
  const { data: board } = await supabase
    .from('boards')
    .select('id')
    .eq('organization_id', ORG_ID)
    .eq('name', boardName)
    .single();

  if (board) {
    const { data: firstStage } = await supabase
      .from('board_stages')
      .select('id')
      .eq('board_id', board.id)
      .order('order', { ascending: true })
      .limit(1)
      .single();

    if (firstStage) {
      await supabase.from('deals').insert({
        id: crypto.randomUUID(),
        organization_id: ORG_ID,
        name: `Lead: ${name}`,
        contact_id: contact.id,
        board_id: board.id,
        stage_id: firstStage.id,
      });
    }
  }

  return NextResponse.json({
    success: true,
    contact_id: contact.id,
    message: `Lead "${name}" criado no ${boardName}`
  });
}

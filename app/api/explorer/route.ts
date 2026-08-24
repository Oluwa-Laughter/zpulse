import { NextResponse, type NextRequest } from "next/server";
import { getChain, getExplorerBlock, getExplorerTx } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const blockParam = searchParams.get("block");
  const txParam = searchParams.get("tx");
  const queryParam = searchParams.get("q")?.trim();

  // If a transaction id is requested
  if (txParam) {
    const envelope = await getExplorerTx(txParam);
    if (!envelope.data) {
      return NextResponse.json(
        { data: null, error: { kind: "NotFound", message: `Transaction ${txParam} not found on node.` }, meta: envelope.meta },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(envelope, { headers: { "Cache-Control": "no-store" } });
  }

  // Handle generalized query parameter
  let targetBlock: string | number | null = blockParam;

  if (queryParam) {
    // If 64-char hex, could be block hash or txid
    if (/^[0-9a-fA-F]{64}$/.test(queryParam)) {
      // First try as block
      const blockEnvelope = await getExplorerBlock(queryParam);
      if (blockEnvelope.data) {
        return NextResponse.json(blockEnvelope, { headers: { "Cache-Control": "no-store" } });
      }
      // If not a block, try as transaction
      const txEnvelope = await getExplorerTx(queryParam);
      if (txEnvelope.data) {
        return NextResponse.json({ data: { isTx: true, ...txEnvelope.data }, meta: txEnvelope.meta }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json(
        { data: null, error: { kind: "NotFound", message: `Hash or TxID "${queryParam}" was not found on the connected Zcash node.` }, meta: blockEnvelope.meta },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // If numeric string, treat as height
    if (/^\d+$/.test(queryParam)) {
      targetBlock = Number(queryParam);
    } else {
      targetBlock = queryParam;
    }
  }

  // If no target block specified, default to modern network tip
  if (targetBlock === null || targetBlock === "") {
    const chainTip = await getChain();
    if (chainTip.data?.estimatedHeight && chainTip.data.estimatedHeight > (chainTip.data.height || 0)) {
      targetBlock = chainTip.data.estimatedHeight;
    } else if (chainTip.data?.height) {
      targetBlock = chainTip.data.height;
    } else {
      targetBlock = 2726400; // Modern NU6 Halving baseline
    }
  }

  const envelope = await getExplorerBlock(targetBlock);
  if (!envelope.data) {
    return NextResponse.json(
      { data: null, error: { kind: "NotFound", message: `Block "${targetBlock}" could not be retrieved from the node.` }, meta: envelope.meta },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(envelope, { headers: { "Cache-Control": "no-store" } });
}

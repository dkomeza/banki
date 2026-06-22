import { NextResponse } from "next/server";
import { importApkg } from "@/lib/apkg";
import { importBankiCardFile } from "@/lib/banki-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an .apkg or .banki.json file." }, { status: 400 });
    }
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".banki.json") && file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "The Banki JSON file must be 20 MB or smaller." }, { status: 400 });
    }
    const report = lowerName.endsWith(".apkg")
      ? await importApkg(file.name, new Uint8Array(await file.arrayBuffer()))
      : lowerName.endsWith(".banki.json")
        ? importBankiCardFile(file.name, await file.text())
        : null;
    if (!report) {
      return NextResponse.json({ error: "Choose an .apkg or .banki.json file." }, { status: 400 });
    }
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}

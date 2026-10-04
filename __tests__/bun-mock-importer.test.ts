import { describe, expect, it } from "vitest";
import { normalizeBunMockImports } from "../scripts/vitest-bun-mock-importer.ts";

describe("Bun mock importer normalisation", () => {
  it("resolves static mocks per distinct importer and preserves source maps", () => {
    const source = `import {vi} from 'vitest'; vi.mock('./dep.ts',()=>({}));`;
    const left = normalizeBunMockImports(source, "/fixture/__tests__/left/test.ts?source");
    const right = normalizeBunMockImports(source, "file:///fixture/__tests__/right/test.ts");
    expect(left?.code).toContain('"/fixture/__tests__/left/dep.ts"');
    expect(right?.code).toContain('"/fixture/__tests__/right/dep.ts"');
    expect(left?.map.sourcesContent).toEqual([source]);
  });
  it("recognises aliases and dynamic-import literals, leaving nonrelative IDs intact", () => {
    const source = `import {vi as mocker} from 'vitest'; mocker.mock(import('./dep.ts'),()=>({})); mocker.unmock('../other.ts'); mocker.mock('zod'); mocker.mock('node:fs');`;
    const result = normalizeBunMockImports(source, "/fixture/__tests__/left/test.ts");
    expect(result?.code).toContain('import("/fixture/__tests__/left/dep.ts")');
    expect(result?.code).toContain('unmock("/fixture/__tests__/other.ts")');
    expect(result?.code).toContain("mocker.mock('zod')");
    expect(result?.code).toContain("mocker.mock('node:fs')");
  });
  it("never rewrites comments, dynamic/template arguments or local/shadowed names", () => {
    const source = `import {vi} from 'vitest'; // vi.mock('./comment.ts')\nfunction local(vi:any){vi.mock('./local.ts')} function own(){const vi={mock(){}};vi.mock('./own.ts')} vi.mock(dynamic); vi.mock(\`./template.ts\`);`;
    expect(normalizeBunMockImports(source, "/fixture/__tests__/test.ts")).toBeUndefined();
    expect(normalizeBunMockImports(`const vi={mock(){}};vi.mock('./local.ts');`, "/fixture/__tests__/test.ts")).toBeUndefined();
  });
  it("leaves production source and package-like dot prefixes unchanged", () => {
    const source = `import {vi} from 'vitest';vi.mock('.bare');`;
    expect(normalizeBunMockImports(source, "/fixture/__tests__/test.ts")).toBeUndefined();
    expect(normalizeBunMockImports(source, "/fixture/src/test.ts")).toBeUndefined();
  });
});

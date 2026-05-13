import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { notebookEditTool } from '../src/tools/notebook-edit.js'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('notebookEditTool', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nb-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true })
  })

  it('replaces cell source', async () => {
    const nb = {
      cells: [{ cell_type: 'code', source: ['print("hello")'], metadata: {}, outputs: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    writeFileSync(path.join(tmpDir, 'test.ipynb'), JSON.stringify(nb))
    const result = await notebookEditTool.execute(
      { notebook_path: 'test.ipynb', cell_number: 0, new_source: 'print("world")' },
      { cwd: tmpDir },
    )
    expect(result.isError).toBeFalsy()
    const updated = JSON.parse(readFileSync(path.join(tmpDir, 'test.ipynb'), 'utf-8'))
    expect(updated.cells[0].source).toEqual(['print("world")'])
  })

  it('inserts new cell', async () => {
    const nb = {
      cells: [{ cell_type: 'code', source: ['x = 1'], metadata: {}, outputs: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    writeFileSync(path.join(tmpDir, 'test.ipynb'), JSON.stringify(nb))
    const result = await notebookEditTool.execute(
      { notebook_path: 'test.ipynb', cell_number: 1, new_source: 'y = 2', edit_mode: 'insert', cell_type: 'code' },
      { cwd: tmpDir },
    )
    expect(result.isError).toBeFalsy()
    const updated = JSON.parse(readFileSync(path.join(tmpDir, 'test.ipynb'), 'utf-8'))
    expect(updated.cells).toHaveLength(2)
    expect(updated.cells[1].source).toEqual(['y = 2'])
  })

  it('deletes cell', async () => {
    const nb = {
      cells: [
        { cell_type: 'code', source: ['a'], metadata: {}, outputs: [] },
        { cell_type: 'code', source: ['b'], metadata: {}, outputs: [] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    writeFileSync(path.join(tmpDir, 'test.ipynb'), JSON.stringify(nb))
    const result = await notebookEditTool.execute(
      { notebook_path: 'test.ipynb', cell_number: 0, new_source: '', edit_mode: 'delete' },
      { cwd: tmpDir },
    )
    expect(result.isError).toBeFalsy()
    const updated = JSON.parse(readFileSync(path.join(tmpDir, 'test.ipynb'), 'utf-8'))
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0].source).toEqual(['b'])
  })

  it('returns error for out of range cell', async () => {
    const nb = {
      cells: [{ cell_type: 'code', source: ['x'], metadata: {}, outputs: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }
    writeFileSync(path.join(tmpDir, 'test.ipynb'), JSON.stringify(nb))
    const result = await notebookEditTool.execute(
      { notebook_path: 'test.ipynb', cell_number: 5, new_source: 'x' },
      { cwd: tmpDir },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('out of range')
  })
})

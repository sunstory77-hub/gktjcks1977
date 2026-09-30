import { useCallback, useRef, useState } from 'react';

const LIMIT = 60;

/**
 * 실행취소 기록. 드래그처럼 연속 변경은 시작 시 checkpoint() 한 번, 이후 replace()로만 갱신한다.
 */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const cur = useRef(initial);
  const [, bump] = useState(0);

  const replace = useCallback((next: T | ((p: T) => T)) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(cur.current) : next;
    cur.current = v;
    setPresent(v);
  }, []);

  const checkpoint = useCallback(() => {
    past.current.push(cur.current);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, []);

  const set = useCallback(
    (next: T | ((p: T) => T)) => {
      checkpoint();
      replace(next);
    },
    [checkpoint, replace],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(cur.current);
    replace(prev);
  }, [replace]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(cur.current);
    replace(next);
  }, [replace]);

  return {
    present,
    set,
    replace,
    checkpoint,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

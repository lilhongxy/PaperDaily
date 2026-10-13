#!/usr/bin/env bash
# DailyPaper 一键启动
#   ./start.sh        生产模式：构建前端后由后端统一提供，打开 http://127.0.0.1:8765
#   ./start.sh dev    开发模式：前端热更新，打开 http://localhost:5173
set -e
cd "$(dirname "$0")"
PY=./.conda-env/bin/python
PORT=8765

if [ ! -x "$PY" ]; then
  echo "未找到 Python 环境，正在创建 .conda-env ..."
  conda create -y -p ./.conda-env python=3.12
  $PY -m pip install -r backend/requirements.txt
fi
[ -d frontend/node_modules ] || (cd frontend && npm install)

if [ "$1" = "dev" ]; then
  (cd backend && ../$PY -m uvicorn app.main:app --host 127.0.0.1 --port $PORT --reload) &
  BACK=$!
  trap 'kill $BACK 2>/dev/null' EXIT
  cd frontend && npm run dev
else
  (cd frontend && npm run build >/dev/null) && echo "前端构建完成"
  echo "DailyPaper 已启动： http://127.0.0.1:$PORT"
  (sleep 1.5 && open "http://127.0.0.1:$PORT") >/dev/null 2>&1 &
  cd backend && exec ../$PY -m uvicorn app.main:app --host 127.0.0.1 --port $PORT
fi

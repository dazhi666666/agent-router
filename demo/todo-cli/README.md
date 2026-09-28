# todo-cli

微型 todo CLI。

用法:
- `node todo.js add 买牛奶`（默认优先级 中）
- `node todo.js add 交房租 --priority 高`
- `node todo.js add --priority=低 整理书架`（`--priority` 可放在文本前或后，也支持 `=` 写法）
- `node todo.js list`
- `node todo.js done 1`

`list` 输出示例（接上面的命令，并已执行 `done 1`）:

```
[ ] #2 交房租 (高)
[x] #1 买牛奶 (中)
[ ] #3 整理书架 (低)
```

按 高 > 中 > 低 排序，同优先级按编号升序；每行末尾标注优先级。

## 优先级说明

- 可选值: `高` / `中` / `低`，不指定时默认 `中`。
- 非法值会提示并以退出码 1 退出，不会添加任务:
  ```
  $ node todo.js add 写周报 --priority 紧急
  无效优先级: 紧急（可选: 高|中|低）
  ```
- 兼容旧数据: 没有优先级字段的任务按 `中` 处理。

## 数据文件

默认保存在当前目录的 `todos.json`，可用环境变量 `TODO_FILE` 指定:

```
TODO_FILE=/tmp/my-todos.json node todo.js list
```

## 运行测试

```
npm test
```

或直接运行 `node test.js`。

## 命令示例

```bash
# 添加一条待办（不指定 --priority 时默认为 中）
$ node todo.js add 买牛奶
已添加: 买牛奶

# 添加一条高优先级待办
$ node todo.js add 写周报 --priority 高
已添加: 写周报

# 查看全部待办（先打印统计行，再按 高 > 中 > 低 排序列出）
$ node todo.js list
共 2 条待办，已完成 0 条
[ ] #2 写周报 (高)
[ ] #1 买牛奶 (中)

# 完成编号为 1 的待办
$ node todo.js done 1
完成: 买牛奶
```

**注意事项**：`node todo.js list` 的输出第一行固定是统计行「共 N 条待办，已完成 M 条」，之后才是按 高 > 中 > 低 排序的待办列表；若用脚本解析 `list` 输出，请跳过第一行。例外：没有任何待办时只输出一行 `(空)`，不打印统计行。
E2E-FOLLOWUP-MARK-V2
DIRECT-MODE-B

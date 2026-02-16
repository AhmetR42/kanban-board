const addBtn = document.querySelector("#addTaskBtn");
const input = document.querySelector("#taskInput");

let draggedTask = null;
let tasks = JSON.parse(localStorage.getItem("tasks")) || [];

function saveTasks() {
  localStorage.setItem("tasks", JSON.stringify(tasks));
}

function updateCounts() {
  const todoCount = document.querySelectorAll("#todo .task").length;
  const inprogressCount = document.querySelectorAll("#inprogress .task").length;
  const doneCount = document.querySelectorAll("#done .task").length;

  document.querySelector("#count-todo").textContent = todoCount;
  document.querySelector("#count-inprogress").textContent = inprogressCount;
  document.querySelector("#count-done").textContent = doneCount;
}

function updateOrder() {
  document.querySelectorAll(".task-list").forEach((column) => {
    const columnId = column.parentElement.id;
    const taskElements = column.querySelectorAll(".task");

    taskElements.forEach((taskEl, index) => {
      const taskId = Number(taskEl.dataset.id);
      const taskObj = tasks.find((t) => t.id === taskId);

      if (taskObj) {
        taskObj.column = columnId;
        taskObj.order = index;
      }
    });
  });

  saveTasks();
  updateCounts();
}

function createTaskElement(taskObj) {
  const task = document.createElement("div");
  task.classList.add("task");
  task.setAttribute("draggable", "true");
  task.dataset.id = taskObj.id;

  const text = document.createElement("span");
  text.textContent = taskObj.text;

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "✕";
  deleteBtn.classList.add("delete-btn");

  deleteBtn.addEventListener("click", function () {
    tasks = tasks.filter((t) => t.id !== taskObj.id);
    task.remove();
    updateOrder(); // also saves + updates counts
  });

  task.addEventListener("dragstart", function () {
    task.classList.add("dragging");
    draggedTask = task;
  });

  task.addEventListener("dragend", function () {
    task.classList.remove("dragging");
    updateOrder();
    draggedTask = null;
  });

  task.appendChild(text);
  task.appendChild(deleteBtn);

  return task;
}

function addTask() {
  const taskText = input.value;
  if (!taskText.trim()) return;

  const newTask = {
    id: Date.now(),
    text: taskText,
    column: "todo",
    order: document.querySelectorAll("#todo .task").length,
  };

  tasks.push(newTask);
  saveTasks();

  const taskElement = createTaskElement(newTask);
  document.querySelector("#todo .task-list").appendChild(taskElement);

  input.value = "";

  updateCounts();
}

addBtn.addEventListener("click", addTask);

input.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    addTask();
  }
});

const columns = document.querySelectorAll(".task-list");

columns.forEach((column) => {
  column.addEventListener("dragenter", () => column.classList.add("is-over"));

  column.addEventListener("dragleave", (event) => {
    if (!column.contains(event.relatedTarget)) {
      column.classList.remove("is-over");
    }
  });

  column.addEventListener("dragover", function (event) {
    event.preventDefault();
  });

  column.addEventListener("drop", function () {
    column.classList.remove("is-over");

    if (draggedTask) {
      column.appendChild(draggedTask);
      updateOrder();
    }
  });
});

function loadTasks() {
  tasks
    .sort((a, b) => a.order - b.order)
    .forEach((taskObj) => {
      const taskElement = createTaskElement(taskObj);

      document
        .querySelector(`#${taskObj.column} .task-list`)
        .appendChild(taskElement);
    });

  updateCounts();
}

loadTasks();
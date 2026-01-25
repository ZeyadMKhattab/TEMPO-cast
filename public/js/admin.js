class AdminPanel {
  constructor() {
    this.subscribersData = [];
    this.sort = {
      by: 'createdAt',
      asc: false,
    };

    this.cacheDom();
    this.bindEvents();
    this.init();
  }

  cacheDom() {
    this.loadingMessage = document.getElementById("loading-message");
    this.table = document.getElementById("subscriber-table");
    this.tableBody = document.getElementById("subscriber-list");
    this.totalEl = document.getElementById("total-subscribers");
    this.activeEl = document.getElementById("active-subscribers");
    this.notificationArea = document.getElementById("notification-area");

    // New elements
    this.addSubscriberBtn = document.getElementById("add-subscriber-btn");
    this.modal = document.getElementById("subscriber-modal");
    this.modalTitle = document.getElementById("modal-title");
    this.modalCloseBtn = this.modal.querySelector(".modal-close");
    this.subscriberForm = document.getElementById("subscriber-form");
    this.viewDetailsContent = document.getElementById("view-details-content");

    // Broadcast elements
    this.broadcastSubject = document.getElementById("broadcast-subject");
    this.broadcastMessage = document.getElementById("broadcast-message");
    this.sendBroadcastBtn = document.getElementById("send-broadcast-btn");

    // Filter and sort elements
    this.tableHeader = document.querySelector("#subscriber-table thead tr:first-child");
    this.filterEmail = document.getElementById("filter-email");
    this.filterStatus = document.getElementById("filter-status");
    this.filterFrequency = document.getElementById("filter-frequency");
    this.filterThreshold = document.getElementById("filter-threshold");
  }

  bindEvents() {
    this.addSubscriberBtn.addEventListener("click", () => this.openModalForAdd());
    this.tableBody.addEventListener("click", this.handleTableClick.bind(this));
    this.subscriberForm.addEventListener("submit", this.handleFormSubmit.bind(this));
    this.modalCloseBtn.addEventListener("click", () => this.closeModal());
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    this.sendBroadcastBtn.addEventListener("click", this.handleSendBroadcast.bind(this));

    // Filter and sort events
    this.tableHeader.addEventListener("click", this.handleSortClick.bind(this));
    const filterInputs = [this.filterEmail, this.filterStatus, this.filterFrequency, this.filterThreshold];
    filterInputs.forEach(input => input.addEventListener("input", () => this.renderTable()));

    this.tableHeader.addEventListener("click", this.handleSortClick.bind(this));
  }

  async init() {
    try {
      await this.fetchAndRenderSubscribers();
    } catch (error) {
      this.loadingMessage.textContent = `Error loading data: ${error.message}`;
      console.error("Failed to fetch subscribers:", error);
    }
  }

  openModalForAdd() {
    this.subscriberForm.reset();
    document.getElementById("subscriber-id").value = "";
    this.modalTitle.textContent = "Add New Subscriber";
    this.subscriberForm.style.display = "block";
    this.viewDetailsContent.style.display = "none";
    this.modal.style.display = "block";
  }

  openModalForView(subscriber) {
    this.modalTitle.textContent = "Subscriber Details";
    this.viewDetailsContent.innerHTML = `
      <p><strong>Email:</strong> ${subscriber.email}</p>
      <p><strong>Status:</strong> ${subscriber.active ? "Active" : "Inactive"}</p>
      <p><strong>Frequency:</strong> ${subscriber.frequency || "N/A"}</p>
      <p><strong>Threshold:</strong> ${subscriber.threshold || "N/A"}</p>
      <p><strong>Age Group:</strong> ${subscriber.healthProfile?.ageGroup || "N/A"}</p>
      <p><strong>Conditions:</strong> ${(subscriber.healthProfile?.conditions || []).join(", ") || "None"}</p>
      <p><strong>Subscribed:</strong> ${new Date(subscriber.createdAt).toLocaleString()}</p>
      <p><strong>Last Notified:</strong> ${subscriber.lastNotified ? new Date(subscriber.lastNotified).toLocaleString() : "Never"}</p>
    `;
    this.subscriberForm.style.display = "none";
    this.viewDetailsContent.style.display = "block";
    this.modal.style.display = "block";
  }

  showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    this.notificationArea.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);

    // Animate out and remove
    setTimeout(() => {
      notification.classList.remove('show');
      notification.addEventListener('transitionend', () => notification.remove());
    }, 4000);
  }

  async handleApiError(response, defaultMessage) {
    if (response.status === 401) {
      this.loadingMessage.textContent = "Unauthorized. You do not have access to this page.";
      this.showNotification("Unauthorized access.", "error");
      return new Error("Unauthorized");
    }

    try {
      const errorData = await response.json();
      return new Error(errorData.error || defaultMessage);
    } catch (e) {
      return new Error(`${defaultMessage} (Status: ${response.status})`);
    }
  }

  renderTable() {
    if (!this.subscribersData) return;

    // 1. Filter
    const filters = {
      email: this.filterEmail.value.toLowerCase(),
      status: this.filterStatus.value,
      frequency: this.filterFrequency.value.toLowerCase(),
      threshold: this.filterThreshold.value.toLowerCase(),
    };

    const filteredSubscribers = this.subscribersData.filter(sub => {
      const status = String(sub.active);
      const frequency = sub.frequency || '';
      const threshold = sub.threshold || '';

      return (
        sub.email.toLowerCase().includes(filters.email) &&
        (filters.status === '' || status === filters.status) &&
        frequency.toLowerCase().includes(filters.frequency) &&
        threshold.toLowerCase().includes(filters.threshold)
      );
    });

    // 2. Sort
    const { by, asc } = this.sort;
    filteredSubscribers.sort((a, b) => {
      let valA = a[by] || '';
      let valB = b[by] || '';

      // Handle dates
      if (by === 'createdAt' || by === 'lastNotified') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      }

      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return 0;
    });

    // 3. Render
    this.loadingMessage.style.display = "none";
    this.table.style.display = "table";

    // Update stats based on the full dataset, not the filtered one
    this.totalEl.textContent = this.subscribersData.length;
    this.activeEl.textContent = this.subscribersData.filter(s => s.active).length;

    this.tableBody.innerHTML = "";
    if (filteredSubscribers.length === 0) {
      this.tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No subscribers match the current filters.</td></tr>`;
    }
    filteredSubscribers.forEach((sub) => {
      const row = document.createElement("tr");
      row.dataset.id = sub._id;
      row.innerHTML = `
          <td>${sub.email}</td>
          <td class="${sub.active ? "status-active" : "status-inactive"}">${sub.active ? "Active" : "Inactive"}</td>
          <td>${sub.frequency || "N/A"}</td>
          <td>${sub.threshold || "N/A"}</td>
          <td>${new Date(sub.createdAt).toLocaleDateString()}</td>
          <td>${sub.lastNotified ? new Date(sub.lastNotified).toLocaleString() : "Never"}</td>
          <td class="action-buttons">
            <button class="view-btn" data-id="${sub._id}">View</button>
            <button class="delete-btn" data-id="${sub._id}">Delete</button>
          </td>
        `;
      this.tableBody.appendChild(row);
    });
  }

  handleSortClick(e) {
    const th = e.target.closest('th[data-sort-by]');
    if (!th) return;

    const sortBy = th.dataset.sortBy;
    if (this.sort.by === sortBy) {
      this.sort.asc = !this.sort.asc;
    } else {
      this.sort.by = sortBy;
      this.sort.asc = true;
    }

    this.tableHeader.querySelectorAll('.sortable').forEach(el => el.classList.remove('asc', 'desc'));
    th.classList.add(this.sort.asc ? 'asc' : 'desc');

    this.renderTable();
  }

  async fetchAndRenderSubscribers() {
    try {
      const response = await fetch("/admin/subscribers");

      const data = await response.json();
      if (data.success) {
        this.subscribersData = data.subscribers;
        this.renderTable();
      }
    } catch (error) {
      this.loadingMessage.textContent = `Error: ${error.message}`;
      console.error("Fetch subscribers error:", error);
    }
  }

  async handleTableClick(e) {
    const target = e.target;
    const id = target.dataset.id;

    if (target.classList.contains("delete-btn")) {
      this.handleDeleteSubscriber(id, target.closest("tr"));
    } else if (target.classList.contains("view-btn")) {
      this.handleViewSubscriber(id);
    }
  }

  async handleViewSubscriber(id) {
    try {
      const response = await fetch(`/admin/subscribers/${id}`);
      if (!response.ok) throw await this.handleApiError(response, "Failed to fetch subscriber details.");
      const data = await response.json();
      this.openModalForView(data.subscriber);
    } catch (error) {
      this.showNotification(error.message, "error");
      console.error("Failed to view subscriber:", error);
    }
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("subscriber-id").value;
    const isNew = !id;

    const conditions = [];
    document.querySelectorAll("#subscriber-conditions input:checked").forEach(input => {
      conditions.push(input.value);
    });

    const subscriberData = {
      email: document.getElementById("subscriber-email").value,
      active: document.getElementById("subscriber-active").value === "true",
      frequency: document.getElementById("subscriber-frequency").value,
      threshold: document.getElementById("subscriber-threshold").value,
      healthProfile: {
        ageGroup: document.getElementById("subscriber-ageGroup").value,
        conditions: conditions,
      }
    };

    const url = isNew ? "/admin/subscribers" : `/admin/subscribers/${id}`;
    const method = isNew ? "POST" : "PUT";

    try {
      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscriberData),
      });

      if (!response.ok) {
        throw await this.handleApiError(response, `Failed to ${isNew ? 'add' : 'update'} subscriber.`);
      }

      this.showNotification(`Successfully ${isNew ? 'added' : 'updated'} subscriber.`);
      this.closeModal();
      this.fetchAndRenderSubscribers();
    } catch (error) {
      this.showNotification(error.message, "error");
      console.error(`Failed to ${isNew ? 'add' : 'update'} subscriber:`, error);
    }
  }

  async handleDeleteSubscriber(subscriberId, row) {
    const email = row.cells[0].textContent;

    if (!confirm(`Are you sure you want to permanently delete ${email}?`)) {
      return;
    }
    try {
      const response = await fetch(`/admin/subscribers/${subscriberId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw await this.handleApiError(response, "Failed to delete subscriber.");
      }
      this.showNotification(`Successfully deleted ${email}`);
      this.fetchAndRenderSubscribers();
    } catch (error) {
      this.showNotification(error.message, "error");
      console.error("Failed to delete subscriber:", error);
    }
  }

  async handleSendBroadcast() {
    const subject = this.broadcastSubject.value.trim();
    const message = this.broadcastMessage.value.trim();

    if (!subject || !message) {
      this.showNotification("Subject and message are required for broadcast.", "error");
      return;
    }

    if (!confirm("Are you sure you want to send this email to all active subscribers?")) {
      return;
    }

    this.sendBroadcastBtn.disabled = true;
    this.sendBroadcastBtn.textContent = "Sending...";

    try {
      const response = await fetch("/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send broadcast.");
      }

      this.showNotification(result.message, "success");
      this.broadcastSubject.value = "";
      this.broadcastMessage.value = "";
    } catch (error) {
      this.showNotification(error.message, "error");
      console.error("Broadcast error:", error);
    } finally {
      this.sendBroadcastBtn.disabled = false;
      this.sendBroadcastBtn.textContent = "Send to All Active Subscribers";
    }
  }

  closeModal() {
    this.modal.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new AdminPanel();
});

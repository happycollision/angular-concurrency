import {createTask, TaskObject, timeout, Schedule} from './task';

const controller = new (class FakeAngularController {
  components: any[] = [];
  destroy(component: any) {
    if (component.ngOnDestroy) component.ngOnDestroy();
    const index = this.components.indexOf(component);
    if (index) this.components.splice(index, 1);
  }
  destroyAll() {
    this.components.forEach(c => this.destroy(c));
    this.reset();
  }
  create<T extends any>(newFn: () => T): T {
    const component = newFn();
    if (component.ngOnInit) component.ngOnInit();
    this.components.push(component);
    return component;
  }
  reset() {
    this.components = [];
  }
})();

afterEach(() => controller.destroyAll());

describe('task creation', () => {
  test('createTask works with `this` assignment', () => {
    class FakeAngularComponent {
      myTask: TaskObject = createTask.call(this, function* (this: FakeAngularComponent) {
        return true;
      });
    }

    let component;
    expect(() => component = controller.create(() =>
      new FakeAngularComponent(),
    )).not.toThrow();

    expect(() => component.myTask.perform()).not.toThrow();
  });

  test('createTask works with a normal call', () => {
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        return true;
      });
    }

    let component;

    expect(() => component = controller.create(() =>
      new FakeAngularComponent(),
    )).not.toThrow();

    expect(() => component.myTask.perform()).not.toThrow();
  });

  test('a task can be created on a component', () => {
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        return true;
      });
    }
    expect(() => controller.create(() =>
      new FakeAngularComponent(),
    )).not.toThrow();
  });
});

describe('performing and cancelling', () => {
  test('a task can be performed', () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        this.count++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();

    expect(component.count).toEqual(1);
  });

  test('a task instance can be cancelled', () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        yield timeout(100);
        this.count++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    const taskInstance = component.myTask.perform();
    taskInstance.cancel();

    expect(component.count).toEqual(0);
  });

  test('all task instances can be cancelled from the main task', async () => {
    let started = 0;
    let finished = 0;
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        started++;
        yield timeout(3);
        finished++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask.perform();
    component.myTask.perform();

    component.myTask.cancelAll();

    await timeout(5);

    expect(started).toEqual(3);
    expect(finished).toEqual(0);
  });
});

describe('yielding', () => {
  test('when yielding a promise, the task will run while the promise is pending', async () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        yield timeout(5);
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    expect(component.myTask.isRunning).toEqual(true);

    await timeout(6);
    expect(component.myTask.isRunning).toEqual(false);
  });

  test('when yielding a taskInstance, execution will pause until the instance is complete', async () => {
    class FakeAngularComponent {
      count = 0;
      myWaitingTask = createTask(this, function* () { yield timeout(5); });
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        yield this.myWaitingTask.perform();
        this.count++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    await timeout(3);
    expect(component.count).toEqual(0);

    await timeout(3);
    expect(component.count).toEqual(1);
  });
});

describe('scheduling', () => {
  test('an incorrect schedule name throws', async () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        return true;
      }).setSchedule('wrong' as Schedule);
    }

    expect(() => controller.create(() => new FakeAngularComponent())).toThrowError('schedule');
  });

  test('a task runs concurrent instances (by default)', async () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        yield timeout(1);
        this.count++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask.perform();
    component.myTask.perform();

    await timeout(1);

    expect(component.count).toEqual(3);
  });

  test('a task can drop concurrent performs', async () => {
    class FakeAngularComponent {
      count = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        yield timeout(1);
        this.count++;
      }).setSchedule('drop');
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask.perform();
    component.myTask.perform();

    await timeout(3);

    expect(component.count).toEqual(1);
  });

  test('a task can restart concurrent performs', async () => {
    class FakeAngularComponent {
      startedCount = 0;
      finishedCount = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        this.startedCount++;
        yield timeout(3);
        this.finishedCount++;
      }).setSchedule('restart');
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    expect(component.startedCount).toEqual(1);
    await timeout(1);
    component.myTask.perform();
    expect(component.startedCount).toEqual(2);
    await timeout(1);
    component.myTask.perform();
    expect(component.startedCount).toEqual(3);

    await timeout(9);

    expect(component.finishedCount).toEqual(1);
    expect(component.myTask.isRunning).toEqual(false); // smoke test for bad logic inside this test.
  });

  test('a task can enqueue performs', async () => {
    class FakeAngularComponent {
      startedCount = 0;
      finishedCount = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        this.startedCount++;
        yield timeout(3);
        this.finishedCount++;
      }).setSchedule('enqueue');
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask.perform();
    await timeout();
    expect(component.startedCount).toEqual(1);

    await timeout(4);
    expect(component.startedCount).toEqual(2);
    expect(component.finishedCount).toEqual(1);

    await timeout(3);
    expect(component.startedCount).toEqual(2);
    expect(component.finishedCount).toEqual(2);
    expect(component.myTask.isRunning).toEqual(false); // smoke test for bad logic inside this test.
  });

  test('enqueued performs can be cancelled with task.cancelAll()', async () => {
    class FakeAngularComponent {
      startedCount = 0;
      finishedCount = 0;
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        this.startedCount++;
        yield timeout(3);
        this.finishedCount++;
      }).setSchedule('enqueue');
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask.perform();
    await timeout();
    expect(component.startedCount).toEqual(1);

    component.myTask.cancelAll();
    await timeout(7);

    expect(component.startedCount).toEqual(1);
    expect(component.finishedCount).toEqual(0);
  });
});

describe('angular lifecycle hooks', () => {
  test('a task is cancelled when the component is destroyed', async () => {
    let outsideStarted = 0;
    let outsideFinished = 0;
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        outsideStarted++;
        yield timeout(3);
        outsideFinished++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    await timeout();
    controller.destroy(component);
    await timeout(4);

    expect(outsideStarted).toEqual(1);
    expect(outsideFinished).toEqual(0);
  });

  test('all tasks are cancelled when the component is destroyed', async () => {
    let outsideStarted = 0;
    let outsideFinished = 0;
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        outsideStarted++;
        yield timeout(3);
        outsideFinished++;
      });

      myTask2: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        outsideStarted++;
        yield timeout(3);
        outsideFinished++;
      });
    }
    const component = controller.create(() => new FakeAngularComponent());

    component.myTask.perform();
    component.myTask2.perform();
    await timeout();
    controller.destroy(component);
    await timeout(4);

    expect(outsideStarted).toEqual(2);
    expect(outsideFinished).toEqual(0);
  });

  test('the original ngOnDestroy is called when the component is destroyed', async () => {
    let original = 0;
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        return true;
      });

      ngOnDestroy() { // tslint:disable-line
        original++;
      }
    }

    const component = controller.create(() => new FakeAngularComponent());
    controller.destroy(component);

    expect(original).toEqual(1);
  });

  test('the original ngOnInit is called when the component is created', async () => {
    let original = 0;
    class FakeAngularComponent {
      myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
        return true;
      });

      ngOnInit() { // tslint:disable-line
        original++;
      }
    }

    controller.create(() => new FakeAngularComponent());

    expect(original).toEqual(1);
  });
});

describe('derived state', () => {
  describe('isRunning', () => {
    test('when a task instance is running, the task is marked as running', async () => {
      class FakeAngularComponent {
        myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
          yield timeout(3);
          return true;
        });
      }
      const component = controller.create(() => new FakeAngularComponent());

      component.myTask.perform();

      expect(component.myTask.isRunning).toEqual(true);
    });

    test('when a task instance is cancelled, the task is marked as not running', async () => {
      class FakeAngularComponent {
        myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
          yield timeout(3);
          return true;
        });
      }
      const component = controller.create(() => new FakeAngularComponent());

      const instance = component.myTask.perform();
      await timeout();
      instance.cancel();

      expect(component.myTask.isRunning).toEqual(false);
    });

    test('when any task instance is running, the task is marked as running', async () => {
      class FakeAngularComponent {
        myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
          yield timeout(3);
          return true;
        });
      }
      const component = controller.create(() => new FakeAngularComponent());

      component.myTask.perform();
      await timeout(2);
      component.myTask.perform();
      await timeout(2);

      expect(component.myTask.isRunning).toEqual(true);
    });

    test('when a task instance has finished, the task is marked as not running', async () => {
      class FakeAngularComponent {
        myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
          yield timeout(1);
          return true;
        });
      }
      const component = controller.create(() => new FakeAngularComponent());

      component.myTask.perform();
      await timeout(2);

      expect(component.myTask.isRunning).toEqual(false);
    });

    test('only when the final task instance has finished, the task is marked as not running', async () => {
      class FakeAngularComponent {
        myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
          yield timeout(3);
          return true;
        });
      }
      const component = controller.create(() => new FakeAngularComponent());

      component.myTask.perform();
      await timeout(2);
      component.myTask.perform();
      await timeout(2);

      expect(component.myTask.isRunning).toEqual(true);
      await timeout(2);
      expect(component.myTask.isRunning).toEqual(false);
    });

    describe('on the instance', () => {
      test('when a task instance is running, it is marked as running', async () => {
        class FakeAngularComponent {
          myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
            yield timeout(3);
            return true;
          });
        }
        const component = controller.create(() => new FakeAngularComponent());

        const instance = component.myTask.perform();

        expect(instance.isRunning).toEqual(true);
      });

      test('when a task instance finished, it is marked as not running', async () => {
        class FakeAngularComponent {
          myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
            yield timeout(2);
            return true;
          });
        }
        const component = controller.create(() => new FakeAngularComponent());

        const instance = component.myTask.perform();
        await timeout(3);

        expect(instance.isRunning).toEqual(false);
      });


      test('when a task instance is cancelled, it is marked as not running', async () => {
        class FakeAngularComponent {
          myTask: TaskObject = createTask(this, function* (this: FakeAngularComponent) {
            yield timeout(15);
            return true;
          });
        }
        const component = controller.create(() => new FakeAngularComponent());

        const instance = component.myTask.perform();
        await timeout(1);
        instance.cancel();

        expect(instance.isRunning).toEqual(false);
      });
    });
  });

  describe('last{Completed, Successful, Error}Value', () => {
    class FakeAngularComponent {
      myAnythingTask: TaskObject = createTask(this, function* (this: FakeAngularComponent, input: any, final?: any) {
        const result = yield input;
        return final || result;
      });
    }
    let component: FakeAngularComponent;

    beforeEach(() => {
      component = controller.create(() => new FakeAngularComponent());
    });

    test('when a task has had no value, it is null', async () => {

      expect(component.myAnythingTask.lastCompletedValue).toEqual(null);
    });

    test('when a task has completed successfully, the returned value is set as lastCompletedValue', async () => {

      component.myAnythingTask.perform('success');
      await timeout();

      expect(component.myAnythingTask.lastCompletedValue).toEqual('success');
    });

    test('when a task has completed successfully, the returned value is set as lastSuccessfulValue', async () => {

      component.myAnythingTask.perform('success');
      await timeout();

      expect(component.myAnythingTask.lastSuccessfulValue).toEqual('success');
    });

    test('when a task has completed in failure, the returned value is set as lastCompletedValue', async () => {
      component.myAnythingTask.perform(new Error('failed'));
      await timeout();

      expect(component.myAnythingTask.lastCompletedValue).toEqual(new Error('failed'));
    });

    test('when a task has completed in failure, the returned value is set as lastErrorValue', async () => {
      component.myAnythingTask.perform(new Error('failed'));
      await timeout();

      expect(component.myAnythingTask.lastErrorValue).toEqual(new Error('failed'));
    });

    test('when a task has yielded a failed promise, the error reason is set as lastCompletedValue', async () => {
      component.myAnythingTask.perform(Promise.reject('mid-task rejection'));
      await timeout();

      expect(component.myAnythingTask.lastCompletedValue).toEqual('mid-task rejection');
    });

    test('when a task has yielded a failed promise, the error reason is set as lastErrorValue', async () => {
      component.myAnythingTask.perform(Promise.reject('mid-task rejection'), 'never should get to this');
      await timeout();

      expect(component.myAnythingTask.lastErrorValue).toEqual('mid-task rejection');
    });

    test('when a task returns a failed promise, the error reason is set as lastCompletedValue', async () => {
      component.myAnythingTask.perform(null, Promise.reject('final rejection'));
      await timeout();

      expect(component.myAnythingTask.lastCompletedValue).toEqual('final rejection');
    });
  });
});

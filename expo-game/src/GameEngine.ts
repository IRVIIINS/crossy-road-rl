import { Dimensions } from "react-native";

import { swipeDirections } from "@/components/GestureView";
import AudioManager from "./AudioManager";
import Characters from "./Characters";
import {
  CrossyCamera,
  CrossyGameMap,
  CrossyRenderer,
  CrossyScene,
} from "./CrossyGame";
import CrossyPlayer from "./CrossyPlayer";
import AutoPilot from "./ai/AutoPilot";
import levelMakerWeights from "./ai/levelMakerWeights.json";
import {
  CAMERA_EASING,
  DEBUG_CAMERA_CONTROLS,
  groundLevel,
  PI_2,
  sceneColor,
  startingRow,
} from "./GameSettings";

// ?headless=1 skips drawing so tests can run the game logic much faster than real time
const HEADLESS = (() => {
  try { return new URLSearchParams(window.location.search).get("headless") === "1"; } catch { return false; }
})();

const normalizeAngle = (angle) => {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
};

export default class Engine {
  // When the game is shown in a pane (split screen), `viewport` is the pane size instead of the window size.
  viewport = null;
  // Shared seed => both panes get the identical road/river layout, so "vs" is a fair race.
  seed = null;
  rng = null;

  setViewport = (viewport) => {
    this.viewport = viewport;
    this.updateScale();
  };

  updateScale = () => {
    const win = Dimensions.get("window");
    const { scale } = win;
    let { width, height } = win;
    let zoom = 400;
    if (this.viewport) {
      ({ width, height } = this.viewport);
      zoom = (400 * width) / 560; // keep the same horizontal field of view as the full-window game
    }
    if (this.camera) {
      this.camera.updateScale({ width, height, scale, zoom });
    }
    if (this.renderer) {
      this.renderer.setSize(width * scale, height * scale);
    }
  };

  // Run `fn` with Math.random replaced by this engine's seeded generator.
  _seeded = (fn) => (...args) => {
    if (this.seed == null) return fn(...args);
    const orig = Math.random;
    Math.random = this.rng;
    try {
      return fn(...args);
    } finally {
      Math.random = orig;
    }
  };

  setupGame = (character) => {
    this.scene = new CrossyScene({});

    this.camera = new CrossyCamera();

    if (DEBUG_CAMERA_CONTROLS) {
      // this.debugControls = new THREE.OrbitControls(this.camera);
    }

    this.scene.worldWithCamera.position.z = -startingRow;

    this.updateScale();

    this.gameMap = new CrossyGameMap({
      heroWidth: 0.7,
      scene: this.scene,
      onCollide: this.onCollide,
    });

    this.camCount = 0;

    // Mesh
    this._hero = new CrossyPlayer(character);

    this.scene.world.add(this._hero);

    this.scene.createParticles();

    // the level-maker AI builds the level (add ?levelmaker=0 to the URL to use the original random generator)
    let useMaker = true;
    try {
      useMaker = new URLSearchParams(window.location.search).get("levelmaker") !== "0";
    } catch {}
    this.gameMap.levelMaker = useMaker ? levelMakerWeights : null;

    this.gameMap.init = this._seeded(this.gameMap.init);
    this.gameMap.newRow = this._seeded(this.gameMap.newRow);
  };

  isGameEnded() {
    return !this._hero.isAlive || this._isGameStateEnded();
  }

  onCollide = async (obstacle = {}, type = "feathers", collision) => {
    if (this.isGameEnded()) {
      return;
    }
    this._hero.isAlive = false;
    this._hero.stopIdle();
    if (collision === "car") {
      AudioManager.playCarHitSound();
      AudioManager.playDeathSound();
    } else if (collision === "train") {
      await AudioManager.playAsync(AudioManager.sounds.train.die[`0`]);
      AudioManager.playDeathSound();
    }
    this.scene.useParticle(this._hero, type, obstacle.speed);
    this.scene.rumble();
    this.gameOver();
  };

  // Setup initial scene
  init = () => {
    if (this.seed != null) {
      // mulberry32
      let a = this.seed >>> 0;
      this.rng = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    this.onGameInit();

    this.camera.position.z = 1;
    this._hero.reset();

    this.scene.resetParticles(this._hero.position);

    this.camCount = 0;

    this.gameMap.reset();

    this._hero.idle();
    this.gameMap.init();

    this.onGameReady();
  };

  // Move scene forward
  forwardScene = () => {
    this.scene.world.position.z -=
      (this._hero.position.z - startingRow + this.scene.world.position.z) *
      CAMERA_EASING;
    // Camera horizontal clamp
    const targetCameraX = Math.max(-3, Math.min(2, -this._hero.position.x));
    this.scene.world.position.x +=
      (targetCameraX - this.scene.world.position.x) * CAMERA_EASING;

    // normal camera speed
    if (-this.scene.world.position.z - this.camCount > 1.0) {
      this.camCount = -this.scene.world.position.z;
      this.gameMap.newRow();
    }
  };

  // Reset variables, restart game
  gameOver = () => {
    this._hero.moving = false;
    // Stop player from finishing a movement
    this._hero.stopAnimations();
    this.autopilot.onEpisodeEnd();
    this.onGameEnded();
    // this.gameState = State.Game.gameOver;

    // this.props.setGameState(this.gameState);
  };

  autopilot = new AutoPilot(this);

  tick = (dt) => {
    // this.drive();
    this.autopilot.update();

    this.gameMap.tick(dt, this._hero);

    if (!this._hero.moving) {
      this._hero.moveOnEntity();
      this._hero.moveOnCar();
      this.checkIfUserHasFallenOutOfFrame();
    }
    this.forwardScene();
  };

  checkIfUserHasFallenOutOfFrame = () => {
    if (this.isGameEnded()) {
      return;
    }
    if (this._hero.position.z < this.camera.position.z - 1) {
      this.scene.rumble();
      this.gameOver();
      AudioManager.playDeathSound();
    }

    // Check if offscreen
    if (this._hero.position.x < -5 || this._hero.position.x > 5) {
      this.scene.rumble();
      this.gameOver();
      AudioManager.playDeathSound();
    }
  };

  pause() {
    cancelAnimationFrame(this.raf);
  }

  unpause() {
    const render = () => {
      this.raf = requestAnimationFrame(render);
      const time = Date.now();
      this.tick(time);
      if (HEADLESS) return; // ?headless=1: simulate without drawing (used by the evaluation harness)
      this.renderer.render(this.scene, this.camera);

      // NOTE: At the end of each frame, notify `Expo.GLView` with the below
      this.renderer.__gl.endFrameEXP();
    };
    render();
  }

  updateScore = () => {
    const position = Math.max(Math.floor(this._hero.position.z) - 8, 0);
    this.onUpdateScore(position);
  };

  moveWithDirection = (direction) => {
    if (this.isGameEnded()) {
      return;
    }

    const { SWIPE_UP, SWIPE_DOWN, SWIPE_LEFT, SWIPE_RIGHT } = swipeDirections;

    this._hero.ridingOn = null;

    if (!this._hero.initialPosition) {
      this._hero.initialPosition = this._hero.position;
      this._hero.targetPosition = this._hero.initialPosition;
    }

    this._hero.skipPendingMovement();

    let velocity = { x: 0, z: 0 };

    this._hero.targetRotation = normalizeAngle(this._hero.rotation.y);
    // const normalizedRotation = normalizeAngle(this._hero.rotation.y)
    switch (direction) {
      case SWIPE_LEFT:
        {
          this._hero.targetRotation = PI_2; // calculateRotation(targetRotation, Math.PI / 2);

          velocity = { x: 1, z: 0 };

          this._hero.targetPosition = {
            x: this._hero.initialPosition.x + 1,
            y: this._hero.initialPosition.y,
            z: this._hero.initialPosition.z,
          };
          this._hero.moving = true;
        }
        break;
      case SWIPE_RIGHT:
        {
          if (this._hero.targetPosition === 0) {
            this._hero.targetPosition = -PI_2;
          } else if (
            (this._hero.targetRotation | 0) !== -(PI_2 | 0) &&
            (this._hero.targetRotation | 0) !== ((Math.PI + PI_2) | 0)
          ) {
            this._hero.targetRotation = Math.PI + PI_2;
          }
          velocity = { x: -1, z: 0 };

          this._hero.targetPosition = {
            x: this._hero.initialPosition.x - 1,
            y: this._hero.initialPosition.y,
            z: this._hero.initialPosition.z,
          };
          this._hero.moving = true;
        }
        break;
      case SWIPE_UP:
        {
          this._hero.targetRotation = 0;
          let rowObject =
            this.gameMap.getRow(this._hero.initialPosition.z) || {};
          if (rowObject.type === "road") {
            AudioManager.playPassiveCarSound();
          }

          let shouldRound = true; // rowObject.type !== 'water';
          velocity = { x: 0, z: 1 };

          this._hero.targetPosition = {
            x: this._hero.initialPosition.x,
            y: this._hero.initialPosition.y,
            z: this._hero.initialPosition.z + 1,
          };

          if (shouldRound) {
            this._hero.targetPosition.x = Math.round(
              this._hero.targetPosition.x
            );
            const { ridingOn } = this._hero;
            if (ridingOn && ridingOn.dir) {
              if (ridingOn.dir < 0) {
                this._hero.targetPosition.x = Math.floor(
                  this._hero.targetPosition.x
                );
              } else if (ridingOn.dir > 0) {
                this._hero.targetPosition.x = Math.ceil(
                  this._hero.targetPosition.x
                );
              } else {
                this._hero.targetPosition.x = Math.round(
                  this._hero.targetPosition.x
                );
              }
            }
          }

          this._hero.moving = true;
        }
        break;
      case SWIPE_DOWN:
        {
          this._hero.targetRotation = Math.PI;
          const row = (this.gameMap.getRow(this._hero.initialPosition.z) || {})
            .type;
          let shouldRound = true; //row !== 'water';
          velocity = { x: 0, z: -1 };

          this._hero.targetPosition = {
            x: this._hero.initialPosition.x,
            y: this._hero.initialPosition.y,
            z: this._hero.initialPosition.z - 1,
          };
          if (shouldRound) {
            this._hero.targetPosition.x = Math.round(
              this._hero.targetPosition.x
            );
            const { ridingOn } = this._hero;
            if (ridingOn && ridingOn.dir) {
              if (ridingOn.dir < 0) {
                this._hero.targetPosition.x = Math.floor(
                  this._hero.targetPosition.x
                );
              } else if (ridingOn.dir > 0) {
                this._hero.targetPosition.x = Math.ceil(
                  this._hero.targetPosition.x
                );
              } else {
                this._hero.targetPosition.x = Math.round(
                  this._hero.targetPosition.x
                );
              }
            }
          }
          this._hero.moving = true;
        }
        break;
    }

    // Check collision using the computed movement.
    if (this.gameMap.treeCollision(this._hero.targetPosition)) {
      // If we collide with an object, then reset the target position so the character just jumps up.
      this._hero.targetPosition = {
        x: this._hero.initialPosition.x,
        y: this._hero.initialPosition.y,
        z: this._hero.initialPosition.z,
      };
      this._hero.moving = false;
    }

    const targetRow =
      this.gameMap.getRow(this._hero.initialPosition.z + velocity.z) || {};
    let finalY = targetRow.entity.top || groundLevel;
    // If the next move is into the river, then we want to jump into it.
    if (targetRow.type === "water") {
      const ridable = targetRow.entity.getRidableForPosition(
        this._hero.targetPosition
      );
      if (!ridable) {
        finalY = targetRow.entity.getPlayerSunkenPosition();
      } else {
        finalY =
          targetRow.entity.getPlayerLowerBouncePositionForEntity(ridable);
      }
    }

    AudioManager.playMoveSound();

    this._hero.targetPosition.y = finalY;

    this._hero.commitMovementAnimations({
      onComplete: () => this.updateScore(),
    });
  };

  beginMoveWithDirection = () => {
    if (this.isGameEnded()) {
      return;
    }
    this._hero.runPosieAnimation();
  };

  _onGLContextCreate = async (gl) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;

    this.renderer = new CrossyRenderer({
      gl,
      antialias: true,
      width,
      height,
      clearColor: sceneColor,
    });

    this.unpause();
  };
}
